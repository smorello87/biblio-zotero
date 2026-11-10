import json
import os
import sys
import tempfile
import uuid
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import omeka_bib_to_zotero as cli


class SourceIdMatching(unittest.TestCase):
    def run_batch(self, reply, entries):
        prompts = []

        def fake_openai(model, messages, api_key):
            prompts.append(messages[-1]["content"])
            return json.dumps(reply)

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(cli, "call_openai_chat", fake_openai), \
                mock.patch.object(cli.time, "sleep"), mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test"}):
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                return cli.batch_parse_with_llm(entries, "openai", "test-model"), prompts
            finally:
                os.chdir(cwd)

    def test_dropped_middle_item_is_stubbed_and_neighbours_keep_their_data(self):
        entries = ["Smith, John. 2020. First.", "Jones, Mary. 2021. Second.", "Brown, Alice. 2022. Third."]
        reply = {"items": [
            {"source_id": 1, "type": "book", "title": "First"},
            {"source_id": 3, "type": "book", "title": "Third"},
        ]}
        results, prompts = self.run_batch(reply, entries)
        self.assertEqual(len(results), 3)
        self.assertEqual((results[0]["title"], results[0]["type"]), ("First", "book"))
        self.assertEqual((results[2]["title"], results[2]["type"]), ("Third", "book"))
        self.assertEqual(results[1]["type"], "manuscript")
        self.assertEqual(results[1]["title"], entries[1])
        self.assertTrue(all("source_id" not in item for item in results))
        self.assertIn("[2] Jones, Mary. 2021. Second.", prompts[0])

    def test_items_returned_out_of_order_are_matched_by_id(self):
        entries = ["A one.", "B two."]
        reply = {"items": [{"source_id": "2", "title": "Two"}, {"source_id": 1, "title": "One"}]}
        results, _ = self.run_batch(reply, entries)
        self.assertEqual([r["title"] for r in results], ["One", "Two"])

    def test_reply_without_source_ids_keeps_positional_matching(self):
        entries = ["A one.", "B two."]
        results, _ = self.run_batch({"items": [{"title": "One"}, {"title": "Two"}]}, entries)
        self.assertEqual([r["title"] for r in results], ["One", "Two"])


class KeyPrompts(unittest.TestCase):
    def test_api_keys_are_read_without_echo(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(cli.getpass, "getpass", return_value=" secret "), \
                mock.patch("builtins.input", side_effect=AssertionError("input() would echo the key")):
            self.assertEqual(cli.prompt_api_key("openai"), "secret")


if __name__ == "__main__":
    unittest.main()


class FakeResponse:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code = status
        self.ok = status < 400
        self.reason = "reason"
        self._body = body if body is not None else {}
        self.headers = headers or {}

    def json(self):
        return self._body


def ok_reply(content="{}", finish="stop"):
    return FakeResponse(200, {"choices": [{"message": {"content": content}, "finish_reason": finish}]})


def gateway_error(status, code, message, headers=None):
    return FakeResponse(status, {"error": {"code": code, "message": message}}, headers)


class CailProvider(unittest.TestCase):
    messages = [{"role": "user", "content": "x"}]

    def call(self, replies):
        calls = []

        def fake_post(url, headers=None, json=None, timeout=None):
            calls.append((url, headers, json))
            return replies[len(calls) - 1]

        with mock.patch.object(cli.requests, "post", fake_post), mock.patch.object(cli.time, "sleep") as sleep:
            try:
                result = cli.call_cail_chat("gpt-oss-120b", self.messages, "key")
            except RuntimeError as exc:
                result = exc
        return result, calls, sleep

    def test_request_shape(self):
        result, calls, _ = self.call([ok_reply('{"items":[]}')])
        self.assertEqual(result, '{"items":[]}')
        url, headers, body = calls[0]
        self.assertEqual(url, "https://tools.ailab.gc.cuny.edu/v1/chat/completions")
        self.assertEqual(body["model"], "gpt-oss-120b")
        self.assertEqual(body["max_tokens"], 16000)
        self.assertEqual(headers["Authorization"], "Bearer key")
        self.assertEqual(str(uuid.UUID(headers["x-cail-request-id"], version=4)), headers["x-cail-request-id"])

    def test_request_id_is_fresh_per_request(self):
        _, first, _ = self.call([ok_reply()])
        _, second, _ = self.call([ok_reply()])
        self.assertNotEqual(first[0][1]["x-cail-request-id"], second[0][1]["x-cail-request-id"])

    def test_single_attempt_when_not_retryable(self):
        result, calls, sleep = self.call([gateway_error(429, "quota_exceeded", "Budget exhausted.", {"x-should-retry": "false", "retry-after": "3600"}), ok_reply()])
        self.assertIsInstance(result, RuntimeError)
        self.assertIn("quota_exceeded", str(result))
        self.assertIn("Budget exhausted.", str(result))
        self.assertEqual(len(calls), 1)
        sleep.assert_not_called()

    def test_one_retry_honouring_retry_after_when_gateway_says_so(self):
        result, calls, sleep = self.call([gateway_error(503, "service_unavailable", "Busy.", {"x-should-retry": "true", "retry-after": "7"}), ok_reply('{"ok":1}')])
        self.assertEqual(result, '{"ok":1}')
        self.assertEqual(len(calls), 2)
        sleep.assert_called_once_with(7)
        self.assertNotEqual(calls[0][1]["x-cail-request-id"], calls[1][1]["x-cail-request-id"])

    def test_at_most_one_retry(self):
        busy = gateway_error(503, "service_unavailable", "Busy.", {"x-should-retry": "true", "retry-after": "1"})
        result, calls, _ = self.call([busy, busy, ok_reply()])
        self.assertIsInstance(result, RuntimeError)
        self.assertEqual(len(calls), 2)

    def test_output_limit_is_an_error(self):
        result, _, _ = self.call([ok_reply("", "length")])
        self.assertIsInstance(result, RuntimeError)
        self.assertIn("out of output room", str(result))

    def test_provider_flag_and_key_env(self):
        self.assertEqual(cli.api_key_env_var("cail"), "CAIL_API_KEY")
        self.assertEqual(cli.api_key_env_var("openai"), "OPENAI_API_KEY")
        self.assertEqual(cli.api_key_env_var("openrouter"), "OPENROUTER_API_KEY")
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(cli.getpass, "getpass", return_value="k"), \
                mock.patch("builtins.input", side_effect=AssertionError("echoing prompt")):
            self.assertEqual(cli.prompt_api_key("cail"), "k")

    def test_batch_parse_routes_to_cail_and_keeps_source_ids(self):
        sent = []

        def fake_cail(model, messages, api_key):
            sent.append((model, api_key))
            return json.dumps({"items": [{"source_id": 1, "type": "book", "title": "One"}]})

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(cli, "call_cail_chat", fake_cail), \
                mock.patch.object(cli.time, "sleep"), mock.patch.dict(os.environ, {"CAIL_API_KEY": "secret"}):
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                results = cli.batch_parse_with_llm(["A one."], "cail", "gpt-oss-120b")
            finally:
                os.chdir(cwd)
        self.assertEqual(sent, [("gpt-oss-120b", "secret")])
        self.assertEqual(results[0]["title"], "One")
