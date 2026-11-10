import json
import os
import sys
import tempfile
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
