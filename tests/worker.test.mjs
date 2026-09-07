import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { quotaSnapshotBody, quotaExceededResponse } from '@cuny-ai-lab/cail-client/testing';
import { createHandler } from '../server/worker.js';

const issuer = await createTestIdentityIssuer();
const env = { CAIL_IDENTITY_JWKS: issuer.jwksJson, CAIL_IDENTITY_ISSUER: issuer.issuer };
async function request(path, body, options = {}) {
  const app = await issuer.mintIdentityJwt({ audience: options.audience || 'cail:bibliography', expiresInSeconds: options.expiry ?? 3600 });
  const gateway = await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: options.other ? TEST_SUBJECTS.bob : TEST_SUBJECTS.alice });
  const headers = { 'x-cail-identity-jwt': app, 'x-cail-gateway-identity-jwt': gateway, origin: options.origin || 'https://tools.ailab.gc.cuny.edu', 'content-type': 'application/json', ...options.headers };
  return new Request(`https://tools.ailab.gc.cuny.edu/bibliography/api/${path}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const batch = { model: '@cf/openai/gpt-oss-120b', entries: [{ id: 'entry-1', source: 'Smith. 2020. A book.' }] };
test('invalid verifier configuration is 503; missing, wrong or mismatched identity is 401', async () => {
  const handle = createHandler({ fetchImpl: () => assert.fail('Must not contact Gateway') });
  assert.equal((await handle(await request('quota'), {})).status, 503);
  assert.equal((await handle(new Request('https://tools.ailab.gc.cuny.edu/bibliography/api/quota'), env)).status, 401);
  for (const options of [{ other: true }, { audience: 'cail:other' }, { expiry: -3600 }]) assert.equal((await handle(await request('parse', batch, options), env)).status, 401);
});
test('both parsing and OCR use the member Gateway leg and strip ambient credentials', async () => {
  const calls = [];
  const handle = createHandler({ fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  } });
  for (const [path, body] of [['parse', batch], ['ocr', { model: 'google/gemini-2.5-flash', image: 'data:image/png;base64,aGVsbG8=' }]]) {
    const req = await request(path, body, { headers: { authorization: 'Bearer do-not-forward', cookie: 'do-not-forward', 'x-cail-metadata': '{"user_id":"forged"}' } });
    const expected = req.headers.get('x-cail-gateway-identity-jwt');
    assert.equal((await handle(req, env)).status, 200);
    const call = calls.at(-1);
    assert.equal(call.url, 'https://tools.ailab.gc.cuny.edu/v1/chat/completions');
    assert.equal(call.init.headers.get('x-cail-identity-jwt'), expected);
    assert.equal(call.init.headers.get('x-cail-app'), 'bibliography');
    assert.equal(call.init.headers.get('authorization'), null);
    assert.equal(call.init.headers.get('cookie'), null);
    assert.equal(call.init.headers.get('x-cail-metadata'), null);
    assert.equal(JSON.parse(call.init.body).model, body.model);
    assert.match(call.init.headers.get('x-cail-request-id'), /^[0-9a-f-]{36}$/);
  }
  assert.equal(calls.length, 2);
});
test('quota is the shared delayed estimate and never preflights inference', async () => {
  const paths = [];
  const snapshot = quotaSnapshotBody();
  const handle = createHandler({ fetchImpl: async url => {
    paths.push(new URL(url).pathname);
    return paths.at(-1) === '/v1/quota' ? Response.json(snapshot) : Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  assert.deepEqual(await (await handle(await request('quota'), env)).json(), snapshot);
  await handle(await request('parse', batch), env);
  assert.deepEqual(paths, ['/v1/quota', '/v1/chat/completions']);
});
test('budget exhaustion is preserved and never retried', async () => {
  let calls = 0;
  const handle = createHandler({ fetchImpl: async () => { calls++; return quotaExceededResponse(); } });
  const response = await handle(await request('parse', batch), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('x-should-retry'), 'false');
  assert.equal(calls, 1);
});
test('rejects cross-origin writes, direct origins, and private URL fetching', async () => {
  const handle = createHandler({ fetchImpl: () => assert.fail('No network expected') });
  assert.equal((await handle(await request('parse', batch, { origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await handle(new Request('https://direct.workers.dev/api/quota'), env)).status, 404);
  assert.equal((await handle(await request('source', { url: 'https://127.0.0.1/private' }), env)).status, 400);
});
