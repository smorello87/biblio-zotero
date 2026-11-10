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
  const failure = async (req, configuration = env) => {
    const response = await handle(req, configuration);
    const { error } = await response.json();
    assert.equal(error.launch, response.status === 401 ? '/launch/bibliography' : undefined, 'every 401 names the launch path, nothing else does');
    return [response.status, error.code];
  };
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
    assert.ok(['deepseek-v4.1-flash-1017', 'gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct'].includes(body.model));
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  } });
  for (const [selector, path] of [['model-select', 'parse'], ['vision-model-select', 'ocr']]) {
    const options = html.match(new RegExp(`<select id="${selector}">([\\s\\S]*?)</select>`))[1];
    const models = [...options.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]).filter(model => model !== 'other');
    assert.equal(models.length, path === 'parse' ? 4 : 3);
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
test('private readiness validates both verifier configurations, actual index asset availability and the Gateway path', async () => {
  const handle = createHandler({ fetchImpl: async url => { assert.equal(new URL(url).pathname, '/v1/catalog'); return catalogOf([]); } });
  const health = () => new Request('https://tools.ailab.gc.cuny.edu/bibliography/health');
  const assets = { fetch: async request => {
    assert.equal(new URL(request.url).pathname, '/');
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
  } };
  for (const configuration of [{}, { ...env, CAIL_IDENTITY_JWKS: 'invalid', ASSETS: assets }, { ...env, CAIL_IDENTITY_ISSUER: 'https://wrong.example', ASSETS: assets }, env, { ...env, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } }]) {
    assert.equal((await handle(health(), configuration)).status, 503);
  }
  const unreachable = createHandler({ fetchImpl: async () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } }) });
  const down = await unreachable(health(), { ...env, ASSETS: assets });
  assert.equal(down.status, 503);
  assert.equal((await down.json()).error.code, 'gateway_unavailable');
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
// Node's AbortSignal.timeout() timers do not keep the event loop alive (workerd's do); hold it open
// while a test waits on one.
const keepingAlive = async work => { const timer = setInterval(() => {}, 1000); try { return await work(); } finally { clearInterval(timer); } };
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
test('output budget and reasoning controls follow the catalog row', async () => {
  const ok = { choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }] };
  // Shapes taken from the public catalog on 2026-11-09.
  const rows = [
    ['gpt-oss-120b', ['text-generation', 'function-calling', 'reasoning', 'structured-output'], { context_length: 128000 }],
    ['deepseek-v4.1-flash-1017', ['text-generation', 'function-calling', 'reasoning', 'vision'], { context_length: 1048576 }],
    ['gemma-4-26b-a4b-it', ['text-generation', 'function-calling', 'reasoning', 'vision'], { context_length: 256000 }],
    ['qwq-32b', ['text-generation', 'reasoning'], { context_length: 12000 }],
    ['kimi-k2.5', ['text-generation', 'vision', 'reasoning'], { provider: 'bedrock-mantle', context_length: 262144 }],
    ['llama-4-scout-17b-16e-instruct', ['text-generation', 'function-calling', 'vision'], { context_length: 131000 }],
    ['gemma-7b-it-lora', ['text-generation'], { context_length: 3500 }],
    ['qwen3-vl-235b-a22b-instruct', ['text-generation', 'vision', 'function-calling'], { provider: 'bedrock-mantle', context_length: 262144 }],
  ];
  const sent = async (model, path = 'parse', entries = 1) => {
    const handle = createHandler({ fetchImpl: async (url, init) => new URL(url).pathname === '/v1/catalog' ? catalogOf(rows) : (calls.push(JSON.parse(init.body)), Response.json(ok)) });
    const calls = [];
    const body = path === 'parse' ? { model, entries: Array.from({ length: entries }, (_, i) => ({ id: `entry-${i}`, source: 'Smith. 2020. A book.' })) } : { model, image: 'data:image/png;base64,aGVsbG8=' };
    assert.equal((await handle(await request(path, body), env)).status, 200);
    const { model: _, messages, temperature, response_format, ...controls } = calls[0];
    return controls;
  };
  const thinkingOff = { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false } };
  // Reasoning: 4,000 headroom + 250 per entry (parse) or 4,000 (OCR), never above 10,000 or half the context.
  assert.deepEqual(await sent('gpt-oss-120b'), { max_tokens: 4250, ...thinkingOff });
  assert.deepEqual(await sent('gpt-oss-120b', 'parse', 25), { max_tokens: 10000, ...thinkingOff });
  // The default model (2026-11-10) for both parse and OCR.
  assert.deepEqual(await sent('deepseek-v4.1-flash-1017', 'parse', 25), { max_tokens: 10000, ...thinkingOff });
  assert.deepEqual(await sent('deepseek-v4.1-flash-1017', 'ocr'), { max_tokens: 8000, ...thinkingOff });
  assert.deepEqual(await sent('gemma-4-26b-a4b-it', 'ocr'), { max_tokens: 8000, ...thinkingOff });
  assert.deepEqual(await sent('qwq-32b', 'parse', 25), { max_tokens: 6000, ...thinkingOff });
  // reasoning_effort is Gateway-gated on the reasoning capability; enable_thinking only on Workers AI.
  assert.deepEqual(await sent('kimi-k2.5', 'ocr'), { max_tokens: 8000, reasoning_effort: 'low' });
  // Non-reasoning Workers AI would otherwise answer with at most 256 tokens; never reasoning controls.
  assert.deepEqual(await sent('llama-4-scout-17b-16e-instruct', 'ocr'), { max_tokens: 16000 });
  assert.deepEqual(await sent('gemma-7b-it-lora'), { max_tokens: 1750 });
  assert.deepEqual(await sent('qwen3-vl-235b-a22b-instruct', 'ocr'), {});
  // Unlisted (or catalog unknown): room, but no reasoning controls that a plain model would reject.
  assert.deepEqual(await sent('not-in-catalog'), { max_tokens: 16000 });
});
test('catalog reads are shared, bounded, and a failed read is retried only after 30 s', async () => {
  let catalogCalls = 0;
  const handle = createHandler({ fetchImpl: async url => {
    if (new URL(url).pathname === '/v1/catalog') { catalogCalls++; return new Response('down', { status: 503 }); }
    return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  for (let i = 0; i < 2; i++) assert.equal((await handle(await request('parse', batch), env)).status, 200);
  assert.equal(catalogCalls, 1);
  let reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const shared = createHandler({ fetchImpl: async url => {
    if (new URL(url).pathname === '/v1/catalog') { reads++; await gate; return catalogOf([['gpt-oss-120b', ['text-generation', 'reasoning']]]); }
    return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  const concurrent = Promise.all([1, 2, 3].map(async () => shared(await request('parse', batch), env)));
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  assert.deepEqual((await concurrent).map(response => response.status), [200, 200, 200]);
  await shared(await request('parse', batch), env);
  assert.equal(reads, 1);
  // A hung catalog costs at most its own deadline, then the call proceeds as for an unlisted model.
  const sent = [];
  const hung = createHandler({ catalogTimeoutMs: 30, fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    sent.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  assert.equal((await keepingAlive(async () => hung(await request('parse', batch), env))).status, 200);
  assert.equal(sent[0].max_tokens, 16000);
});
test('a caller cancelling during the catalog read neither aborts it nor poisons the cache', async () => {
  let reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  const handle = createHandler({ fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') { reads++; await gate; assert.equal(init.signal.aborted, false); return catalogOf([['gpt-oss-120b', ['text-generation', 'reasoning']]]); }
    sent.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: { content: '{}' } }] });
  } });
  const controller = new AbortController();
  const signed = await request('parse', batch);
  const cancelled = handle(new Request(signed, { signal: controller.signal }), env);
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  assert.equal((await cancelled).status, 499);
  release();
  assert.equal((await handle(await request('parse', batch), env)).status, 200);
  assert.equal(reads, 1);
  assert.equal(sent.length, 1, 'the cancelled request never reached chat completions');
  assert.equal(sent[0].reasoning_effort, 'low', 'the second request saw the real catalog row');
});
test('timeouts tell the person to use fewer entries or another model', async () => {
  const slow = createHandler({ deadlineMs: 30, fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/v1/catalog') return catalogOf([]);
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  } });
  const response = await keepingAlive(async () => slow(await request('parse', batch), env));
  assert.equal(response.status, 504);
  const { error } = await response.json();
  assert.equal(error.code, 'request_timeout');
  assert.match(error.message, /fewer entries per request or another model/);
  const upstream = createHandler({ fetchImpl: async url => new URL(url).pathname === '/v1/catalog' ? catalogOf([]) : cailErrorResponse(504, cailErrorEnvelope({ code: 'upstream_timeout', type: 'upstream_timeout', message: 'The provider did not finish this request in time.' }), { 'x-should-retry': 'false' }) });
  const gateway = await (await upstream(await request('parse', batch), env)).json();
  assert.equal(gateway.error.code, 'upstream_timeout');
  assert.match(gateway.error.message, /^The provider did not finish this request in time\. .*fewer entries per request or another model/);
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
test('source import cancels unusable bodies and reports a redirect without Location', async () => {
  const source = async (...responses) => {
    const cancelled = [];
    const queue = responses.map(([status, headers]) => () => new Response(new ReadableStream({ cancel() { cancelled.push(status); } }), { status, headers }));
    const handle = createHandler({ fetchImpl: async () => queue.shift()() });
    const response = await handle(await request('source', { url: 'https://italianamericanimprints.omeka.net/actual-bibliography' }), env);
    return { status: response.status, code: (await response.json()).error?.code, cancelled };
  };
  assert.deepEqual(await source([404, {}]), { status: 502, code: 'source_unavailable', cancelled: [404] });
  assert.deepEqual(await source([200, { 'content-type': 'application/pdf' }]), { status: 400, code: 'unsupported_source', cancelled: [200] });
  assert.deepEqual(await source([302, {}]), { status: 502, code: 'source_redirect_invalid', cancelled: [302] });
  assert.deepEqual(await source([301, { location: 'https://evil.example/' }]), { status: 400, code: 'unsupported_source', cancelled: [301] });
  const upper = createHandler({ fetchImpl: async () => new Response('<p>x</p>', { headers: { 'content-type': 'TEXT/HTML; charset=utf-8' } }) });
  assert.equal((await (await upper(await request('source', { url: 'https://italianamericanimprints.omeka.net/x' }), env)).json()).html, true);
});
test('in production every Gateway call goes through the GATEWAY binding, never global fetch to the zone', async () => {
  const real = globalThis.fetch;
  const global = [], bound = [];
  // A global fetch to the tool's own zone reaches the zone origin, which answers 404 (the 2026-11-09 outage).
  globalThis.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input); global.push(url); return new URL(url).hostname === 'tools.ailab.gc.cuny.edu' ? new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } }) : Response.json({ docs: [] }); };
  try {
    const quota = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/quota-2026-11-10.json', import.meta.url), 'utf8'));
    const GATEWAY = { fetch: async (input, init) => {
      const url = new URL(String(input)); bound.push(url.pathname);
      assert.ok(new Headers(init.headers).get('x-cail-identity-jwt') || url.pathname === '/v1/catalog');
      if (url.pathname === '/v1/catalog') return catalogOf([['gpt-oss-120b', ['text-generation', 'reasoning']]]);
      if (url.pathname === '/v1/quota') return Response.json(quota);
      return Response.json({ choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }] });
    } };
    const handle = createHandler();
    const production = { ...env, GATEWAY };
    const quotaResponse = await handle(await request('quota'), production);
    assert.equal(quotaResponse.status, 200);
    assert.deepEqual(await quotaResponse.json(), quota);
    assert.equal((await handle(await request('parse', batch), production)).status, 200);
    assert.equal((await handle(await request('catalog'), production)).status, 200);
    assert.equal((await handle(await request('enrich', { type: 'book', title: 'A Book', author: 'Smith' }), production)).status, 200);
    assert.deepEqual(bound.sort(), ['/v1/catalog', '/v1/catalog', '/v1/chat/completions', '/v1/quota'].sort());
    assert.deepEqual([...new Set(global.map(url => new URL(url).hostname))].sort(), ['api.crossref.org', 'openlibrary.org', 'www.googleapis.com'], 'only the catalogs use global fetch');
    const missing = await createHandler()(await request('quota'), env);
    assert.equal(missing.status, 502);
    assert.equal(global.filter(url => new URL(url).hostname === 'tools.ailab.gc.cuny.edu').length, 0, 'without the binding the Worker still never falls back to global fetch');
  } finally { globalThis.fetch = real; }
});
