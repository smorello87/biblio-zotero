import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../api.js';

const failure = (status, code, headers = {}) => new Response(JSON.stringify({ error: { code, message: 'No.', request_id: 'r' } }), { status, headers: { 'content-type': 'application/json', ...headers } });
function setup(response, extra = {}) {
  const calls = [], assigned = [];
  const location = { href: 'https://tools.ailab.gc.cuny.edu/bibliography/', assign: url => assigned.push(String(url)) };
  const api = createApi({ fetchImpl: async (...args) => { calls.push(args); return response(); }, location, base: new URL('api/', location.href), ...extra });
  return { api, calls, assigned };
}
test('lost CAIL session restarts sign-in once with no retry of the request', async () => {
  for (const code of ['authentication_required', 'session_invalid']) {
    const { api, calls, assigned } = setup(() => failure(401, code));
    await assert.rejects(api('quota'), error => error.status === 401 && error.signInRestarted === true);
    await assert.rejects(api('quota'), error => error.signInRestarted === false);
    assert.deepEqual(assigned, ['https://tools.ailab.gc.cuny.edu/bibliography/']);
    assert.equal(calls.length, 2, 'each call fetches once; nothing is re-issued');
  }
});
test('sign-in restart is not repeated across a reload within a minute', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = setup(() => failure(401, 'session_invalid'), { storage });
  await assert.rejects(first.api('quota'));
  const second = setup(() => failure(401, 'session_invalid'), { storage });
  await assert.rejects(second.api('quota'));
  assert.equal(first.assigned.length, 1);
  assert.equal(second.assigned.length, 0);
});
test('the Worker invalid_credential code and other errors only show an error', async () => {
  for (const [status, code] of [[401, 'invalid_credential'], [403, 'authentication_required'], [429, 'quota_exceeded']]) {
    const { api, assigned } = setup(() => failure(status, code));
    await assert.rejects(api('parse', {}), error => error.code === code && !error.signInRestarted);
    assert.deepEqual(assigned, []);
  }
});
test('retry advice is exposed from x-should-retry and retry-after', async () => {
  const { api } = setup(() => failure(503, 'service_unavailable', { 'x-should-retry': 'true', 'retry-after': '12' }));
  await assert.rejects(api('parse', {}), error => error.shouldRetry === true && error.retryAfter === 12);
  const none = setup(() => failure(429, 'quota_exceeded', { 'x-should-retry': 'false' }));
  await assert.rejects(none.api('parse', {}), error => error.shouldRetry === false && error.retryAfter === undefined);
});
test('a non-envelope error body still yields a safe error', async () => {
  for (const body of ['null', '42', '{"error":{"message":{"x":1}}}']) {
    const { api } = setup(() => new Response(body, { status: 502, headers: { 'content-type': 'application/json' } }));
    await assert.rejects(api('parse', {}), error => error.status === 502 && error.message === 'The CAIL service is unavailable.');
  }
});
test('unusable model output, timeouts and network failures keep the Retry button even though the Worker sends x-should-retry: false', async () => {
  for (const code of ['invalid_model_response', 'model_output_limit', 'request_timeout', 'network_error']) {
    const { api } = setup(() => failure(502, code, { 'x-should-retry': 'false' }));
    await assert.rejects(api('parse', {}), error => error.shouldRetry === true);
  }
  const { api } = setup(() => failure(429, 'quota_exceeded', { 'x-should-retry': 'false' }));
  await assert.rejects(api('parse', {}), error => error.shouldRetry === false);
});
test('Doorway launch path is used when the 401 names one, and only for a same-origin /launch/ path', async () => {
  const withLaunch = launch => () => new Response(JSON.stringify({ error: { code: 'authentication_required', launch } }), { status: 401, headers: { 'content-type': 'application/json' } });
  const good = setup(withLaunch('/launch/bibliography'));
  await assert.rejects(good.api('quota'));
  assert.deepEqual(good.assigned, ['https://tools.ailab.gc.cuny.edu/launch/bibliography']);
  const bad = setup(withLaunch('//evil.example/launch/x'));
  await assert.rejects(bad.api('quota'));
  assert.deepEqual(bad.assigned, ['https://tools.ailab.gc.cuny.edu/bibliography/']);
});
