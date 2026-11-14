import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenApi, createCatalogFetch, catalogFromOpenRouter, catalogFromModelList, familyModels, controlsFor, endpointBase, modelControls, OPEN_PARSE, OPEN_VISION } from '../open/api.js';
import { modelMenus } from '../models.js';
import { SourceError } from '../server/lookup.js';

const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const MODELS = { data: [
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', context_length: 1048576, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['reasoning', 'response_format'] },
  { id: 'qwen/qwen3-vl-235b-a22b-instruct', name: 'Qwen3 VL', context_length: 262144, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['response_format'] },
  { id: 'some/plain-model', name: 'Plain', context_length: 8000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: [] },
  { id: 'deepseek/deepseek-v4.1-flash:batch', name: 'Batch variant', context_length: 1048576, architecture: { input_modalities: ['text'] }, supported_parameters: [] },
] };
function setup({ key = 'sk-or-v1-abcdefghijkl', provider = 'openrouter', base, reply } = {}) {
  const calls = [];
  const api = createOpenApi({
    getConfig: () => ({ provider, base, key }),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === 'https://openrouter.ai/api/v1/models') return jsonResponse(MODELS);
      return reply ? reply(String(url), init) : jsonResponse({ id: 'gen-1', choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });
    },
  });
  return { api, calls };
}
const entries = [{ id: 'a', source: 'Woolf, Virginia. A Room of One’s Own. London: Hogarth Press, 1929.' }];

test('conversion without a key fails before any request, and is not offered as a retry', async () => {
  const { api, calls } = setup({ key: '' });
  await assert.rejects(api('parse', { model: OPEN_PARSE[0].id, entries }), error => error.code === 'missing_key' && error.shouldRetry === false);
  assert.equal(calls.length, 0);
  assert.deepEqual(await api('session'), { authenticated: false });
});

test('parse sends the citations to OpenRouter with the key, JSON mode and reasoning controls from the model list', async () => {
  const { api, calls } = setup();
  const result = await api('parse', { model: 'deepseek/deepseek-v4.1-flash', entries });
  assert.deepEqual(result, { content: '{"items":[]}', request_id: 'gen-1' });
  const chat = calls.find(call => call.url.endsWith('/chat/completions'));
  assert.equal(chat.init.headers.authorization, 'Bearer sk-or-v1-abcdefghijkl');
  assert.equal(chat.init.credentials, 'omit');
  const payload = JSON.parse(chat.init.body);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.deepEqual(payload.reasoning, { effort: 'low', exclude: true });
  assert.equal(payload.max_tokens, 4250);
  assert.deepEqual(JSON.parse(payload.messages[1].content), [{ source_id: 'a', citation: entries[0].source }]);
});

test('a model without JSON mode or reasoning gets neither, and a capped output budget', () => {
  const catalog = catalogFromOpenRouter(MODELS);
  const plain = catalog.data.find(row => row.id === 'some/plain-model');
  assert.equal(plain.json, false);
  assert.deepEqual(modelControls(plain, 'parse', 25), { temperature: 0, max_tokens: 4000 });
  assert.deepEqual(modelControls(undefined, 'ocr', 1), { temperature: 0, max_tokens: 16000 });
});

test('OpenRouter refusals become readable errors', async () => {
  for (const [status, code, retry] of [[401, 'invalid_key', false], [402, 'insufficient_credits', false], [429, 'rate_limited', true], [503, 'upstream_error', true]]) {
    const { api } = setup({ reply: () => jsonResponse({ error: { message: 'no' } }, status, { 'retry-after': '30' }) });
    await assert.rejects(api('parse', { model: 'deepseek/deepseek-v4.1-flash', entries }), error => error.code === code && error.status === status && error.shouldRetry === retry && error.retryAfter === 30);
  }
});

test('truncated, empty and mid-stream-error replies are reported, not parsed', async () => {
  const cases = [
    [{ choices: [{ finish_reason: 'length', message: { content: '{"items":[' } }] }, 'model_output_limit'],
    [{ choices: [{ finish_reason: 'stop', message: { content: '  ' } }] }, 'invalid_model_response'],
    [{ error: { message: 'provider failed' } }, 'upstream_error'],
  ];
  for (const [reply, code] of cases) {
    const { api } = setup({ reply: () => jsonResponse(reply) });
    await assert.rejects(api('parse', { model: 'deepseek/deepseek-v4.1-flash', entries }), error => error.code === code);
  }
});

test('OCR sends one page image and no JSON mode', async () => {
  const { api, calls } = setup();
  await api('ocr', { model: 'qwen/qwen3-vl-235b-a22b-instruct', image: 'data:image/png;base64,AAAA' });
  const payload = JSON.parse(calls.find(call => call.url.endsWith('/chat/completions')).init.body);
  assert.equal(payload.response_format, undefined);
  assert.equal(payload.messages[0].content[1].image_url.url, 'data:image/png;base64,AAAA');
  await assert.rejects(api('ocr', { model: 'qwen/qwen3-vl-235b-a22b-instruct', image: 'https://example.com/x.png' }), error => error.code === 'invalid_image');
});

test('a model ID is required and may not contain spaces', async () => {
  const { api } = setup();
  for (const model of ['', '  ', 'a b', 'x'.repeat(201)]) await assert.rejects(api('parse', { model, entries }), error => error.code === 'invalid_model');
});

test('the OpenRouter list feeds the shared menus; curated open-weight models come first', () => {
  const menus = modelMenus(catalogFromOpenRouter(MODELS), { fallbackParse: OPEN_PARSE, fallbackVision: OPEN_VISION });
  assert.deepEqual(menus.parse.map(m => m.id), ['deepseek/deepseek-v4.1-flash', 'qwen/qwen3-vl-235b-a22b-instruct']);
  assert.equal(menus.parse[0].label, 'DeepSeek V4.1 Flash');
  assert.ok(!menus.suggestions.some(m => m.id.includes(':')), 'variants like :batch are left out');
  assert.deepEqual(modelMenus(null, { fallbackParse: OPEN_PARSE, fallbackVision: OPEN_VISION }).parse, OPEN_PARSE);
});

test('catalog requests reach only the four catalog hosts; Wikidata gets origin=*', async () => {
  const seen = [];
  const fetchJSON = createCatalogFetch(async (url, init) => { seen.push({ url: String(url), init }); return jsonResponse({ search: [] }); });
  const signal = new AbortController().signal;
  await fetchJSON('Wikidata', 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Casablanca', 1000, signal);
  assert.equal(new URL(seen[0].url).searchParams.get('origin'), '*');
  assert.equal(seen[0].init.credentials, 'omit');
  await assert.rejects(fetchJSON('X', 'https://evil.example/search.json', 1000, signal), error => error instanceof SourceError && error.kind === 'disabled');
  await assert.rejects(fetchJSON('X', 'http://openlibrary.org/search.json', 1000, signal), error => error.kind === 'disabled');
  assert.equal(seen.length, 1);
});

test('catalog replies: 404 is "no record", other failures are SourceErrors', async () => {
  const signal = new AbortController().signal;
  const reply = response => createCatalogFetch(async () => response());
  assert.equal(await reply(() => new Response('', { status: 404 }))('Crossref', 'https://api.crossref.org/works/x', 1000, signal), null);
  await assert.rejects(reply(() => new Response('', { status: 429 }))('Google Books', 'https://www.googleapis.com/books/v1/volumes?q=x', 1000, signal), error => error.kind === 'status' && error.status === 429);
  await assert.rejects(reply(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }))('Crossref', 'https://api.crossref.org/works?x', 1000, signal), error => error.kind === 'unreadable');
  await assert.rejects(reply(() => jsonResponse({ big: 'x'.repeat(2000) }))('Crossref', 'https://api.crossref.org/works?x', 100, signal), error => error.kind === 'too_large');
  await assert.rejects(reply(async () => { throw new TypeError('offline'); })('Crossref', 'https://api.crossref.org/works?x', 100, signal), error => error.kind === 'network');
});

test('enrich runs the shared lookup in the browser; website import is CAIL-only', async () => {
  const { api } = setup({ reply: url => jsonResponse(url.includes('openlibrary') ? { docs: [] } : url.includes('crossref') ? { message: { items: [] } } : { items: [] }) });
  const result = await createOpenApi({ getConfig: () => ({ provider: 'openrouter', key: '' }), fetchImpl: async url => jsonResponse(String(url).includes('openlibrary') ? { docs: [] } : String(url).includes('crossref') ? { message: { items: [] } } : {}), pause: async () => {} })('enrich', { type: 'book', title: 'A Room of One’s Own', author: 'Woolf', year: 1929 });
  assert.equal(result.status, 'not_found');
  await assert.rejects(api('enrich', { type: 'book' }), error => error.code === 'invalid_request');
  await assert.rejects(api('source', { url: 'https://italianamericanimprints.omeka.net/' }), error => error.code === 'unsupported_source');
});

test('endpoint URLs: HTTPS anywhere, plain HTTP only on this computer', () => {
  assert.equal(endpointBase('https://api.example.org/v1/'), 'https://api.example.org/v1');
  assert.equal(endpointBase('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(endpointBase('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
  for (const bad of ['http://example.org/v1', 'ftp://x/v1', 'https://user:pw@x.org/v1', 'https://x.org/v1?key=1', 'not a url', '']) assert.equal(endpointBase(bad), null, bad);
});

test('other endpoints: key sent as a bearer token to their own URL, OpenAI parameters for OpenAI', async () => {
  const { api, calls } = setup({ provider: 'openai', key: 'sk-proj-abc' });
  await api('parse', { model: 'gpt-5-mini', entries });
  const chat = calls.find(call => call.url === 'https://api.openai.com/v1/chat/completions');
  assert.equal(chat.init.headers.authorization, 'Bearer sk-proj-abc');
  assert.equal(chat.init.headers['x-title'], undefined, 'no OpenRouter-only headers elsewhere');
  const payload = JSON.parse(chat.init.body);
  assert.deepEqual([payload.temperature, payload.max_tokens, payload.max_completion_tokens, payload.response_format], [undefined, undefined, 16000, { type: 'json_object' }]);
  assert.ok(!calls.some(call => call.url.includes('openrouter')), 'nothing goes to OpenRouter');
  assert.deepEqual(controlsFor('generic', undefined, 'parse', 5), { temperature: 0 });
});

test('a local server needs no key; a custom endpoint needs a valid URL', async () => {
  const local = setup({ provider: 'local', key: '', base: 'http://localhost:11434/v1' });
  await local.api('parse', { model: 'llama3.2', entries });
  const chat = local.calls.find(call => call.url === 'http://localhost:11434/v1/chat/completions');
  assert.equal(chat.init.headers.authorization, undefined);
  const custom = setup({ provider: 'custom', key: 'k', base: 'http://example.org/v1' });
  await assert.rejects(custom.api('parse', { model: 'm', entries }), error => error.code === 'invalid_endpoint');
  assert.equal(custom.calls.length, 0);
  assert.deepEqual(await custom.api('session'), { authenticated: false });
});

test('a 400 is retried once with only the model and messages', async () => {
  const bodies = [];
  const { api } = setup({ provider: 'custom', base: 'https://llm.example.org/v1', key: 'k', reply: (url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? jsonResponse({ error: { message: 'response_format not supported' } }, 400) : jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] }); } });
  assert.equal((await api('parse', { model: 'm', entries })).content, '{"items":[]}');
  assert.equal(bodies.length, 2);
  assert.ok('response_format' in bodies[0] && 'temperature' in bodies[0]);
  assert.deepEqual(Object.keys(bodies[1]).sort(), ['messages', 'model']);
});

test('other endpoints list their own models, chat models only, preferred first', async () => {
  const catalog = catalogFromModelList({ data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-5' }, { id: 'gpt-5-mini' }, { id: 'whisper-1' }, { id: 'gpt-image-1' }] }, 'openai');
  assert.deepEqual(catalog.data.map(row => row.id), ['gpt-5-mini', 'gpt-5']);
  const ollama = catalogFromModelList({ data: [{ id: 'qwen2.5vl:7b' }, { id: 'llama3.2:latest' }] }, 'local');
  assert.deepEqual(ollama.data.map(row => row.id), ['qwen2.5vl:7b', 'llama3.2:latest'], 'family models first, the rest after');
  const { api, calls } = setup({ provider: 'groq', key: 'gsk_x', reply: () => jsonResponse({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] }) });
  const listed = await api('catalog');
  assert.equal(listed.data[0].id, 'openai/gpt-oss-120b');
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer gsk_x');
  assert.equal(await api('quota'), null, 'only OpenRouter reports key usage');
  const nokey = setup({ provider: 'mistral', key: '' });
  assert.deepEqual(await nokey.api('catalog'), { data: [] });
  assert.equal(nokey.calls.length, 0, 'no listing request without a key');
});

test('menus offer every current-generation family model, newest first, the newest DeepSeek Flash as default', () => {
  const rows = [
    { id: 'deepseek/deepseek-v3.2', created: 1 }, { id: 'deepseek/deepseek-v4-pro', created: 5 }, { id: 'deepseek/deepseek-v4.1-flash', created: 6 },
    { id: 'deepseek/deepseek-v4.1-flash-1017', created: 7 }, { id: 'deepseek/deepseek-v4-flash-vision-exp', created: 8 },
    { id: 'qwen/qwen2.5-vl-72b-instruct', created: 1 }, { id: 'qwen/qwen3-vl-235b-a22b-instruct', created: 2 }, { id: 'qwen/qwen3-vl-8b-instruct', created: 3 }, { id: 'qwen/qwen3-vl-30b-a3b-thinking', created: 4 },
    { id: 'google/gemma-3-12b-it', created: 1 }, { id: 'google/gemma-4-31b-it', created: 2 },
    { id: 'openai/gpt-oss-20b', created: 1 }, { id: 'openai/gpt-oss-120b', created: 2 }, { id: 'openai/gpt-5', created: 9 },
  ];
  assert.deepEqual(familyModels(rows).map(row => row.id), [
    'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro',
    'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
    'google/gemma-4-31b-it',
    'qwen/qwen3-vl-8b-instruct', 'qwen/qwen3-vl-235b-a22b-instruct',
  ]);
});

test('a new release in a family replaces the old generation without a code change', () => {
  const rows = [{ id: 'deepseek/deepseek-v4.1-flash', created: 1 }, { id: 'deepseek/deepseek-v5-flash', created: 2 }, { id: 'deepseek/deepseek-v5-pro', created: 3 }];
  assert.deepEqual(familyModels(rows).map(row => row.id), ['deepseek/deepseek-v5-flash', 'deepseek/deepseek-v5-pro']);
});

test('other endpoints: families when they carry them (Ollama tags included), otherwise every chat model', () => {
  const ollama = catalogFromModelList({ models: [{ name: 'gemma3:27b' }, { name: 'gemma2:9b' }, { name: 'qwen2.5vl:7b' }, { name: 'llama3.2:latest' }] }, 'local');
  assert.deepEqual(ollama.data.filter(row => row.recommended).map(row => row.id), ['gemma3:27b', 'qwen2.5vl:7b']);
  assert.equal(ollama.data.length, 4, 'the rest stay as suggestions');
  const openai = catalogFromModelList({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }, 'openai');
  assert.deepEqual(openai.data.filter(row => row.recommended).map(row => row.id), ['gpt-5-mini', 'gpt-5']);
});
