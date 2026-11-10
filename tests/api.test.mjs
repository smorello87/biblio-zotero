import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, LAUNCH_PATH } from '../api.js';

const failure = (status, code, headers = {}, extra = {}) => new Response(JSON.stringify({ error: { code, message: 'No.', request_id: 'r', ...extra } }), { status, headers: { 'content-type': 'application/json', ...headers } });
const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };
function setup(response, extra = {}) {
  const calls = [], assigned = [];
  const location = { href: 'https://tools.ailab.gc.cuny.edu/bibliography/', assign: url => assigned.push(String(url)) };
  const api = createApi({ fetchImpl: async (...args) => { calls.push(args); return response(); }, location, base: new URL('api/', location.href), storage: memoryStorage(), ...extra });
  return { api, calls, assigned };
}
const launchURL = 'https://tools.ailab.gc.cuny.edu/launch/bibliography';
test('lost CAIL session restarts sign-in once at the launch path, with no retry of the request', async () => {
  assert.equal(LAUNCH_PATH, '/launch/bibliography');
  for (const code of ['authentication_required', 'session_invalid']) {
    const { api, calls, assigned } = setup(() => failure(401, code));
    await assert.rejects(api('quota'), error => error.status === 401 && error.signInRestarted === true && error.signInUrl === launchURL);
    await assert.rejects(api('quota'), error => error.signInRestarted === false && error.signInUrl === launchURL);
    assert.deepEqual(assigned, [launchURL]);
    assert.equal(calls.length, 2, 'each call fetches once; nothing is re-issued');
  }
});
test('sign-in restart is not repeated across a reload within a minute, but the link is still offered', async () => {
  const storage = memoryStorage();
  let clock = 1_000_000;
  const first = setup(() => failure(401, 'session_invalid'), { storage, now: () => clock });
  await assert.rejects(first.api('quota'));
  clock += 59_000;
  const second = setup(() => failure(401, 'session_invalid'), { storage, now: () => clock });
  await assert.rejects(second.api('quota'), error => error.signInRestarted === false && error.signInUrl === launchURL);
  clock += 2_000;
  const third = setup(() => failure(401, 'session_invalid'), { storage, now: () => clock });
  await assert.rejects(third.api('quota'));
  assert.deepEqual([first.assigned.length, second.assigned.length, third.assigned.length], [1, 0, 1]);
});
test('without usable sessionStorage the page never navigates on its own and offers the link instead', async () => {
  const broken = [
    undefined,
    null,
    { getItem() { throw new Error('SecurityError'); }, setItem() {} },
    { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } },
    { getItem: () => null, setItem() {} },
  ];
  for (const storage of broken) {
    const { api, assigned } = setup(() => failure(401, 'authentication_required'), { storage });
    for (let i = 0; i < 3; i++) await assert.rejects(api('quota'), error => error.signInRestarted === false && error.signInUrl === launchURL);
    assert.deepEqual(assigned, []);
  }
});
test('the Worker invalid_credential code and other errors only show an error', async () => {
  for (const [status, code] of [[401, 'invalid_credential'], [403, 'authentication_required'], [429, 'quota_exceeded']]) {
    const { api, assigned } = setup(() => failure(status, code, {}, { launch: '/launch/bibliography' }));
    await assert.rejects(api('parse', {}), error => error.code === code && !error.signInRestarted && error.signInUrl === undefined);
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
test('unusable output, timeouts and network failures keep the Retry button even though the Worker sends x-should-retry: false', async () => {
  for (const code of ['invalid_model_response', 'model_output_limit', 'request_timeout', 'upstream_timeout', 'network_error']) {
    const { api } = setup(() => failure(502, code, { 'x-should-retry': 'false' }));
    await assert.rejects(api('parse', {}), error => error.shouldRetry === true);
  }
  const { api } = setup(() => failure(429, 'quota_exceeded', { 'x-should-retry': 'false' }));
  await assert.rejects(api('parse', {}), error => error.shouldRetry === false);
});
test('a browser-side timeout or network failure becomes a readable, retryable error; a cancel stays a cancel', async () => {
  const timeout = setup(() => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  await assert.rejects(timeout.api('parse', {}), error => error.code === 'request_timeout' && error.shouldRetry === true && /fewer entries per request or another model/.test(error.message));
  const offline = setup(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.api('parse', {}), error => error.code === 'network_error' && error.shouldRetry === true);
  const controller = new AbortController(); controller.abort();
  const cancelled = setup(() => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(cancelled.api('parse', {}, controller.signal), error => error.name === 'AbortError');
});
test('a 401 launch value is used only when it is a same-origin /launch/ path', async () => {
  const withLaunch = launch => () => failure(401, 'authentication_required', {}, { launch });
  const good = setup(withLaunch('/launch/bibliography'));
  await assert.rejects(good.api('quota'));
  assert.deepEqual(good.assigned, [launchURL]);
  for (const launch of ['//evil.example/launch/x', 'https://evil.example/launch/x', '/launch/../welcome', 'javascript:alert(1)', 42]) {
    const bad = setup(withLaunch(launch));
    await assert.rejects(bad.api('quota'), error => error.signInUrl === launchURL);
    assert.deepEqual(bad.assigned, [launchURL]);
  }
});
