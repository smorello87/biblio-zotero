import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { quotaSnapshotBody, quotaExceededResponse, cailErrorEnvelope, cailErrorResponse } from '@cuny-ai-lab/cail-client/testing';
import { createHandler } from '../server/worker.js';

const issuer = await createTestIdentityIssuer();
const env = { CAIL_IDENTITY_JWKS: issuer.jwksJson, CAIL_IDENTITY_ISSUER: issuer.issuer };
async function request(path, body, options = {}) {
  const app = await issuer.mintIdentityJwt({ audience: options.audience || 'cail:bibliography', expiresInSeconds: options.expiry ?? 3600 });
  const gateway = await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: options.other ? TEST_SUBJECTS.bob : TEST_SUBJECTS.alice });
  const headers = { 'x-cail-identity-jwt': app, 'x-cail-gateway-identity-jwt': gateway, origin: options.origin || 'https://tools.ailab.gc.cuny.edu', 'content-type': 'application/json', ...options.headers };
  return new Request(`https://tools.ailab.gc.cuny.edu/bibliography/api/${path}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const catalogRow = (id, overrides = {}) => ({ id, object: 'model', recommended: false, tier: 'advanced', order: 10, status: 'active', modality: 'text', provider: 'workers-ai', upstream_model: id, pricing_known: 'catalog', streaming: true, sunset: null, capabilities: ['text-generation'], context_length: 8192, registry_url: null, ...overrides });
const catalogOf = rows => Response.json({ object: 'list', data: rows.map(([id, capabilities, overrides]) => catalogRow(id, { capabilities, ...overrides })) });
const batch = { model: 'gpt-oss-120b', entries: [{ id: 'entry-1', source: 'Smith. 2020. A book.' }] };
test('invalid verifier configuration is 503; missing identity is authentication_required; wrong, malformed or mismatched identity is invalid_credential', async () => {
  const handle = createHandler({ fetchImpl: () => assert.fail('Must not contact Gateway') });
  const failure = async (req, configuration = env) => { const response = await handle(req, configuration); return [response.status, (await response.json()).error.code]; };
  assert.deepEqual(await failure(await request('quota'), {}), [503, 'identity_unavailable']);
  assert.deepEqual(await failure(new Request('https://tools.ailab.gc.cuny.edu/bibliography/api/quota'), {}), [503, 'identity_unavailable']);
  assert.deepEqual(await failure(new Request('https://tools.ailab.gc.cuny.edu/bibliography/api/quota')), [401, 'authentication_required']);
  for (const options of [{ other: true }, { audience: 'cail:other' }, { expiry: -3600 }, { headers: { 'x-cail-identity-jwt': 'not-a-jwt' } }, { headers: { 'x-cail-gateway-identity-jwt': 'not-a-jwt' } }, { headers: { 'x-cail-gateway-identity-jwt': '' } }]) {
    assert.deepEqual(await failure(await request('parse', batch, options)), [401, 'invalid_credential'], JSON.stringify(options));
  }
  const appOnly = await request('parse', batch);
  appOnly.headers.delete('x-cail-gateway-identity-jwt');
  assert.deepEqual(await failure(appOnly), [401, 'invalid_credential']);
});
test('both parsing and OCR use the member Gateway leg and strip ambient credentials', async () => {
  const calls = [];
  const handle = createHandler({ fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') return catalogOf([['gpt-oss-120b', ['text-generation', 'reasoning']], ['qwen3-vl-235b-a22b-instruct', ['text-generation', 'vision']]]);
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
    if (new URL(url).pathname === '/v1/catalog') return catalogOf([]);
    paths.push(new URL(url).pathname);
    return paths.at(-1) === '/v1/quota' ? Response.json(snapshot) : Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  assert.deepEqual(await (await handle(await request('quota'), env)).json(), snapshot);
  await handle(await request('parse', batch), env);
  assert.deepEqual(paths, ['/v1/quota', '/v1/chat/completions']);
});
test('budget exhaustion is preserved and never retried', async () => {
  let calls = 0;
  const handle = createHandler({ fetchImpl: async url => { if (new URL(url).pathname === '/v1/catalog') return catalogOf([]); calls++; return quotaExceededResponse(); } });
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
test('catalog with a bedrock-runtime row is served (cail-client 6.3.0 parser)', async () => {
  const handle = createHandler({ fetchImpl: async () => Response.json({ object: 'list', data: [catalogRow('gpt-oss-120b'), catalogRow('claude-on-bedrock', { provider: 'bedrock-runtime' })] }) });
  const response = await handle(await request('catalog'), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.map(row => row.id), ['gpt-oss-120b', 'claude-on-bedrock']);
});
const enrichBody = { title: 'A Book', author: 'Smith' };
const enrich = async upstream => {
  const calls = [];
  const handle = createHandler({ fetchImpl: async (url, init) => { calls.push(init); return upstream(); } });
  const response = await handle(await request('enrich', enrichBody), env);
  assert.equal(calls[0].redirect, 'manual');
  return response;
};
test('enrich treats a redirect as unavailable and cancels the body', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const response = await enrich(() => new Response(body, { status: 302, headers: { location: 'https://evil.example/' } }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'enrichment_unavailable');
  assert.equal(cancelled, true);
});
test('enrich rejects an oversized Open Library body', async () => {
  const response = await enrich(() => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'enrichment_unavailable');
});
test('enrich tolerates malformed docs and only links Open Library works', async () => {
  const response = await enrich(() => Response.json({ docs: [{ title: 'A Book', isbn: [123, null, '9780306406157'], key: '@evil.example/x', publisher: ['P'] }] }));
  assert.equal(response.status, 200);
  const { suggestion } = await response.json();
  assert.equal(suggestion.fields.ISBN, '9780306406157');
  assert.equal(suggestion.url, 'https://openlibrary.org');
  const good = await enrich(() => Response.json({ docs: [{ isbn: 'not-an-array', key: '/works/OL123W' }] }));
  const data = await good.json();
  assert.equal(data.suggestion.url, 'https://openlibrary.org/works/OL123W');
  assert.equal(data.suggestion.fields.ISBN, undefined);
  assert.equal((await (await enrich(() => new Response('not json'))).json()).error.code, 'enrichment_unavailable');
});
test('enrich passes only short, well-formed strings into suggested fields', async () => {
  const hostile = { title: { toString: 1 }, isbn: ['97803064061570000', '030640615X'], oclc: [{ a: 1 }, '12345'], lccn: [['x'], '2001012345'], publisher: [7, 'x'.repeat(301), 'Press'], publish_place: [null], number_of_pages_median: '12; DROP', key: '/works/OL1W' };
  const { suggestion } = await (await enrich(() => Response.json({ docs: [hostile] }))).json();
  assert.equal(suggestion.title, 'A Book');
  assert.deepEqual(suggestion.fields, { ISBN: '030640615X', OCLC: '12345', 'call-number': '2001012345', publisher: 'Press' });
  const typical = { title: 'A Book', isbn: ['0306406152', '9780306406157'], oclc: ['42'], lccn: ['n79021164'], publisher: ['Plenum'], publish_place: ['New York'], number_of_pages_median: 316, key: '/works/OL1W' };
  assert.deepEqual((await (await enrich(() => Response.json({ docs: [typical] }))).json()).suggestion.fields, { ISBN: '9780306406157', OCLC: '42', 'call-number': 'n79021164', publisher: 'Plenum', 'publisher-place': 'New York', 'number-of-pages': '316' });
});
test('retryable 503 forwards x-should-retry and Retry-After; quota exhaustion is non-retryable', async () => {
  const unavailable = createHandler({ fetchImpl: async () => cailErrorResponse(503, cailErrorEnvelope({ code: 'service_unavailable', type: 'server_error', cail: { retry_after_seconds: 7 } }), { 'x-should-retry': 'true' }) });
  const busy = await unavailable(await request('parse', batch), env);
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get('x-should-retry'), 'true');
  assert.equal(busy.headers.get('retry-after'), '7');
  const exceeded = createHandler({ fetchImpl: async () => quotaExceededResponse() });
  const spent = await exceeded(await request('parse', batch), env);
  assert.equal(spent.status, 429);
  assert.equal((await spent.json()).error.code, 'quota_exceeded');
  assert.equal(spent.headers.get('x-should-retry'), 'false');
  assert.equal(spent.headers.get('retry-after'), '3600');
});
const modelCall = async (rows, model, reply, path = 'parse') => {
  const sent = [];
  const handle = createHandler({ fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') return catalogOf(rows);
    sent.push(JSON.parse(init.body));
    return Response.json(reply);
  } });
  const body = path === 'parse' ? { ...batch, model } : { model, image: 'data:image/png;base64,aGVsbG8=' };
  const response = await handle(await request(path, body), env);
  return { response, sent };
};
test('reasoning, unlisted and Workers AI models get explicit output room capped by context; other plain models keep their default', async () => {
  const ok = { choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }] };
  // Shapes taken from the public catalog on 2026-11-09.
  const rows = [
    ['gpt-oss-120b', ['text-generation', 'function-calling', 'reasoning', 'structured-output'], { context_length: 128000 }],
    ['gemma-4-26b-a4b-it', ['text-generation', 'function-calling', 'reasoning', 'vision'], { context_length: 256000 }],
    ['qwq-32b', ['text-generation', 'reasoning'], { context_length: 24000 }],
    ['llama-4-scout-17b-16e-instruct', ['text-generation', 'function-calling', 'vision'], { context_length: 131000 }],
    ['gemma-7b-it-lora', ['text-generation'], { context_length: 3500 }],
    ['qwen3-vl-235b-a22b-instruct', ['text-generation', 'vision', 'function-calling'], { provider: 'bedrock-mantle', context_length: 262144 }],
  ];
  assert.equal((await modelCall(rows, 'gpt-oss-120b', ok)).sent[0].max_tokens, 16000);
  assert.equal((await modelCall(rows, 'gemma-4-26b-a4b-it', ok, 'ocr')).sent[0].max_tokens, 16000);
  assert.equal((await modelCall(rows, 'qwq-32b', ok)).sent[0].max_tokens, 12000);
  // A non-reasoning Workers AI model would otherwise answer with at most 256 tokens.
  assert.equal((await modelCall(rows, 'llama-4-scout-17b-16e-instruct', ok, 'ocr')).sent[0].max_tokens, 16000);
  assert.equal((await modelCall(rows, 'gemma-7b-it-lora', ok)).sent[0].max_tokens, 1750);
  assert.equal((await modelCall(rows, 'qwen3-vl-235b-a22b-instruct', ok, 'ocr')).sent[0].max_tokens, undefined);
  assert.equal((await modelCall(rows, 'not-in-catalog', ok)).sent[0].max_tokens, 16000);
});
test('capabilities are cached per handler and a catalog outage still requests output room', async () => {
  let catalogCalls = 0;
  const handle = createHandler({ fetchImpl: async url => {
    if (new URL(url).pathname === '/v1/catalog') { catalogCalls++; return new Response('down', { status: 503 }); }
    return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  for (let i = 0; i < 2; i++) assert.equal((await handle(await request('parse', batch), env)).status, 200);
  assert.equal(catalogCalls, 1);
  const cached = [];
  const good = createHandler({ fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') { cached.push('catalog'); return catalogOf([['gpt-oss-120b', ['text-generation', 'reasoning']]]); }
    return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  await good(await request('parse', batch), env); await good(await request('parse', batch), env);
  assert.equal(cached.length, 1);
});
test('an exhausted output budget is its own error, with and without content', async () => {
  for (const content of ['', '{"items":[{"source_id":"entry-1"']) {
    const { response } = await modelCall([], 'gpt-oss-120b', { choices: [{ message: { content }, finish_reason: 'length' }] });
    assert.equal(response.status, 502);
    const { error } = await response.json();
    assert.equal(error.code, 'model_output_limit');
    assert.match(error.message, /fewer entries/);
  }
  const { response } = await modelCall([], 'gpt-oss-120b', { choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
  assert.equal((await response.json()).error.code, 'invalid_model_response');
});
