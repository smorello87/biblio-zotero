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
const batch = { model: 'gpt-oss-120b', entries: [{ id: 'entry-1', source: 'Smith. 2020. A book.' }] };
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
  for (const [path, body] of [['parse', batch], ['ocr', { model: 'qwen3-vl-235b-a22b-instruct', image: 'data:image/png;base64,aGVsbG8=' }]]) {
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
test('all curated model options reach Gateway unchanged; legacy prefixes are rejected', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const handle = createHandler({ fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(['gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct'].includes(body.model));
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  } });
  for (const [selector, path] of [['model-select', 'parse'], ['vision-model-select', 'ocr']]) {
    const options = html.match(new RegExp(`<select id="${selector}">([\\s\\S]*?)</select>`))[1];
    const models = [...options.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]).filter(model => model !== 'other');
    assert.equal(models.length, path === 'parse' ? 3 : 2);
    for (const model of models) {
      const body = path === 'parse' ? { ...batch, model } : { model, image: 'data:image/png;base64,aGVsbG8=' };
      assert.equal((await handle(await request(path, body), env)).status, 200);
    }
  }
  const reject = createHandler({ fetchImpl: () => assert.fail('Invalid IDs must not reach Gateway') });
  for (const model of ['', '@cf/openai/gpt-oss-120b', 'openai/gpt-oss-120b', 'auto/gpt-oss-120b', 'qwen/qwen3-vl-235b-a22b-instruct', 'gpt oss', 'x'.repeat(201)]) {
    for (const path of ['parse', 'ocr']) {
      const response = await reject(await request(path, { ...batch, model, image: 'data:image/png;base64,aGVsbG8=' }), env);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'invalid_model');
    }
  }
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
test('bare mount redirects authenticated GET and HEAD to the asset base, preserving query', async () => {
  const handle = createHandler({ fetchImpl: () => assert.fail('No network expected') });
  for (const method of ['GET', 'HEAD']) {
    const signed = await request('session');
    const response = await handle(new Request('https://tools.ailab.gc.cuny.edu/bibliography?example=1', { method, headers: signed.headers }), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://tools.ailab.gc.cuny.edu/bibliography/?example=1');
  }
  assert.equal((await handle(new Request('https://tools.ailab.gc.cuny.edu/bibliography'), env)).status, 401);
});
test('private readiness validates both verifier configurations and actual index asset availability', async () => {
  const handle = createHandler({ fetchImpl: () => assert.fail('No Gateway calls expected') });
  const health = () => new Request('https://tools.ailab.gc.cuny.edu/bibliography/health');
  const assets = { fetch: async request => {
    assert.equal(new URL(request.url).pathname, '/');
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
  } };
  for (const configuration of [{}, { ...env, CAIL_IDENTITY_JWKS: 'invalid', ASSETS: assets }, { ...env, CAIL_IDENTITY_ISSUER: 'https://wrong.example', ASSETS: assets }, env, { ...env, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } }]) {
    assert.equal((await handle(health(), configuration)).status, 503);
  }
  const response = await handle(health(), { ...env, ASSETS: assets, CF_VERSION_METADATA: { id: 'tested-version', tag: 'tested-release' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready', version_id: 'tested-version', tag: 'tested-release' });
});
const catalogRow = (id, overrides = {}) => ({ id, object: 'model', recommended: false, tier: 'advanced', order: 10, status: 'active', modality: 'text', provider: 'workers-ai', upstream_model: id, pricing_known: 'catalog', streaming: true, sunset: null, capabilities: ['text-generation'], context_length: 8192, registry_url: null, ...overrides });
test('catalog with a bedrock-runtime row is served (cail-client 6.3.0 parser)', async () => {
  const handle = createHandler({ fetchImpl: async () => Response.json({ object: 'list', data: [catalogRow('gpt-oss-120b'), catalogRow('claude-on-bedrock', { provider: 'bedrock-runtime' })] }) });
  const response = await handle(await request('catalog'), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.map(row => row.id), ['gpt-oss-120b', 'claude-on-bedrock']);
});
