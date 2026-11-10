import { CAIL_CANONICAL_ISSUER, loadIdentityVerifierConfig, readIdentityKeyring, verifyIdentityJwt, verifyKeyringGatewayJwt } from '@cuny-ai-lab/cail-identity';
import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { parsingPrompt, ocrPrompt } from './prompts.js';
import { runLookup, SourceError } from './lookup.js';
import { validateItem } from '../core.js';

const ORIGIN = 'https://tools.ailab.gc.cuny.edu';
const AUDIENCE = 'cail:bibliography';
// Doorway's launch route for this tool; 401 bodies carry it so the page restarts sign-in there.
const LAUNCH_PATH = '/launch/bibliography';
const MAX_BODY = 8 * 1024 * 1024;
// Workers AI Chat defaults max_tokens to 256 when the caller omits it (Gateway adds a default only
// for GPT-OSS), which truncates any CSL-JSON batch. Non-reasoning Workers AI and unlisted models ask
// for this much room, capped at half the model's context window so the input still fits.
const MAX_OUTPUT_TOKENS = 16000;
// Reasoning models bill thinking as output. LanGames measured (2026-09-20) that 4,000 tokens of
// headroom let every recommended reasoning model answer, while a larger budget let one reason past a
// two-minute timeout. So reasoning models get the catalog-gated reasoning_effort "low" (and, on Workers
// AI, enable_thinking: false), 4,000 tokens of headroom plus room for the expected output, and a hard
// cap that a model can emit well inside the 180 s deadline.
const REASONING_HEADROOM_TOKENS = 4000;
const REASONING_MAX_TOKENS = 10000;
const OUTPUT_TOKENS_PER_ENTRY = 250;
const OCR_OUTPUT_TOKENS = 4000;
const DEADLINE_MS = 180000;
const CATALOG_CACHE_MS = 10 * 60 * 1000;
const CATALOG_RETRY_MS = 30000;
const CATALOG_TIMEOUT_MS = 5000;
// Catalog lookups reach only these hosts, over HTTPS, with URLs this Worker builds; a person's input
// is never fetched. CATALOG_HOSTS (wrangler.toml) can narrow the list, never extend it.
const CATALOG_HOSTS = ['openlibrary.org', 'api.crossref.org', 'www.googleapis.com', 'www.wikidata.org'];
const CATALOG_TIMEOUT_PER_SOURCE_MS = 8000;
// Identifies the tool to the catalogs (Wikidata's User-Agent policy; Crossref's polite pool).
const CATALOG_USER_AGENT = 'CUNY-AI-Lab-Bibliography/1.0 (https://tools.ailab.gc.cuny.edu/bibliography/; mailto:ailab@gc.cuny.edu)';
const TIMEOUT_ADVICE = 'Completed entries are preserved. Try fewer entries per request or another model.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class AppError extends Error {
  constructor(code, message, status = 400) { super(message); Object.assign(this, { code, status }); }
}
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

async function boundedText(message, limit = MAX_BODY) {
  if (Number(message.headers.get('content-length')) > limit) throw new AppError('body_too_large', 'This document is too large. Try a smaller section.', 413);
  if (!message.body) return '';
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AppError('body_too_large', 'This document is too large. Try a smaller section.', 413); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function bodyJSON(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('invalid_request', 'Send a JSON request.', 415);
  try { return JSON.parse(await boundedText(request)); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('invalid_request', 'The request could not be read.'); }
}

function validateModel(model) {
  if (typeof model !== 'string' || model.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(model)) throw new AppError('invalid_model', 'Choose a model or enter its exact prefix-free Gateway ID.');
  return model;
}

async function verifierConfigs(env) {
  const configs = await Promise.all([AUDIENCE, 'cail:gateway'].map(expectedAudience => loadIdentityVerifierConfig({ jwks: env.CAIL_IDENTITY_JWKS, issuer: env.CAIL_IDENTITY_ISSUER, expectedAudience, supportedIssuers: [CAIL_CANONICAL_ISSUER] })));
  if (configs.some(result => !result.ok)) throw new AppError('identity_unavailable', 'Sign-in verification is temporarily unavailable.', 503);
  return configs.map(result => result.config);
}

async function readiness(env, client) {
  await verifierConfigs(env);
  // The Gateway is reachable only through the GATEWAY service binding: a global fetch() to
  // tools.ailab.gc.cuny.edu from a Worker in the same zone goes to the zone's origin, not to the
  // Gateway Worker, and answers 404. Reading the public catalog through the binding proves the path
  // without a credential or any spend.
  try { await client.getCatalogSnapshot({ modality: 'all', signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) }); }
  catch { throw new AppError('gateway_unavailable', 'The model service is unreachable from this tool.', 503); }
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') throw new AppError('assets_unavailable', 'Application assets are unavailable.', 503);
  const asset = await env.ASSETS.fetch(new Request(`${ORIGIN}/`));
  const available = asset.ok && asset.headers.get('content-type')?.includes('text/html');
  await asset.body?.cancel();
  if (!available) throw new AppError('assets_unavailable', 'Application assets are unavailable.', 503);
  return json({ status: 'ready', version_id: env.CF_VERSION_METADATA?.id || null, tag: env.CF_VERSION_METADATA?.tag || null });
}

async function authenticate(request, env) {
  const configs = await verifierConfigs(env);
  // Only an absent app leg means "no session" (which makes the page restart sign-in). A present but
  // malformed leg is an invalid credential, like one that fails verification.
  if (request.headers.get('x-cail-identity-jwt') === null) throw new AppError('authentication_required', 'Sign in with CUNY to continue.', 401);
  const keyring = readIdentityKeyring(request.headers);
  if (!keyring) throw new AppError('invalid_credential', 'Your sign-in has expired or is invalid. Sign in again.', 401);
  const identity = await verifyIdentityJwt(keyring.appJwt, configs[0]);
  if (!identity || !await verifyKeyringGatewayJwt(keyring, configs[1], identity.subject)) throw new AppError('invalid_credential', 'Your sign-in has expired or is invalid. Sign in again.', 401);
  return { kind: 'jwt', token: keyring.gatewayJwt };
}

const lookupString = (value, max) => value === undefined || value === null || value === '' ? undefined : typeof value === 'string' && value.length <= max ? value.trim() : null;
function enrichQuery(body) {
  const fields = { title: lookupString(body?.title, 500), author: lookupString(body?.author, 250), container: lookupString(body?.container, 500), url: lookupString(body?.url, 2000), doi: lookupString(body?.doi, 250), isbn: lookupString(body?.isbn, 40) };
  const yearOk = value => value === undefined || value === null || (Number.isInteger(value) && value > 0 && value < 3000);
  if (!body || typeof body !== 'object' || !validateItem({ type: body.type, title: 'x' }) || !fields.title || Object.values(fields).includes(null) || !yearOk(body.year) || !yearOk(body.yearEnd)) throw new AppError('invalid_request', 'Provide the entry type, title and optional creator, year and identifiers for catalog lookup.');
  return { type: body.type, ...fields, author: fields.author || '', year: body.year ?? undefined, yearEnd: body.yearEnd ?? undefined };
}

// Google Books keys are sent only to this host, only as a header (URLs get logged), and never appear
// in a reply, an error message or a log line.
const GOOGLE_HOST = 'www.googleapis.com';
const GOOGLE_KEY = /^[A-Za-z0-9_-]{20,100}$/;
// Google's quota refusals: 429, or 403 naming a quota reason (older and current error formats).
const GOOGLE_QUOTA = /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|rateLimitExceeded|dailyLimitExceeded|quotaExceeded|userRateLimitExceeded/;

// One catalog request: allowlisted HTTPS hosts only, redirects re-checked (at most two), bounded
// body, its own deadline. Returns parsed JSON, null for 404, or throws a SourceError; a caller abort
// propagates as an AbortError.
function createCatalogFetch(publicFetch) {
  return async function catalogFetch(address, limit, allowed, signal, googleKey) {
    let target = new URL(address);
    const deadline = AbortSignal.timeout(CATALOG_TIMEOUT_PER_SOURCE_MS);
    const both = AbortSignal.any([signal, deadline]);
    for (let hop = 0; hop < 3; hop++) {
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !CATALOG_HOSTS.includes(target.hostname)) throw new SourceError('redirect');
      if (!allowed.includes(target.hostname)) throw new SourceError('disabled');
      const google = target.hostname === GOOGLE_HOST;
      if (google && googleKey === null) throw new SourceError('misconfigured');
      // Rebuilt for every hop, so a redirect to another host never carries the key.
      const headers = { accept: 'application/json', 'user-agent': CATALOG_USER_AGENT, ...(google && googleKey ? { 'x-goog-api-key': googleKey } : {}) };
      let response;
      try { response = await publicFetch(target, { redirect: 'manual', credentials: 'omit', signal: both, headers }); }
      catch (error) { if (signal.aborted) throw error; throw new SourceError(deadline.aborted ? 'timeout' : 'network'); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new SourceError('redirect');
        try { target = new URL(location, target); } catch { throw new SourceError('redirect'); }
        continue;
      }
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) {
        // With the Lab's key, a quota refusal means the Lab's daily quota is spent. Read only enough
        // of the error to tell; its text is never passed on.
        if (google && googleKey && [403, 429].includes(response.status)) {
          let reason = '';
          try { reason = await boundedText(response, 64 * 1024); } catch { /* the status alone decides */ }
          if (response.status === 429 || GOOGLE_QUOTA.test(reason)) throw new SourceError('quota', response.status);
        } else await response.body?.cancel();
        throw new SourceError('status', response.status);
      }
      if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new SourceError('unreadable'); }
      let text;
      try { text = await boundedText(response, limit); }
      catch (error) { if (signal.aborted) throw error; if (error instanceof AppError) throw new SourceError('too_large'); throw new SourceError(deadline.aborted ? 'timeout' : 'network'); }
      try { return JSON.parse(text); } catch { throw new SourceError('unreadable'); }
    }
    throw new SourceError('redirect');
  };
}

// Catalog replies are public data, so they are cached for everyone: about a day for a record, ten
// minutes for "nothing found", never for a refusal, server error or timeout (those throw). The key
// is a hash of the source and the request URL this Worker built; the Google key is a header and is
// never part of it, and nothing about the person is. Two layers: an in-isolate LRU (always works)
// and the Cache API (caches.default), which Cloudflare documents as functional for Workers on custom
// domains and which may be a no-op for a Worker reached only through a service binding.
const CACHE_HIT_SECONDS = 24 * 60 * 60;
const CACHE_EMPTY_SECONDS = 10 * 60;
const CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 1000;
const CACHE_KEY_BASE = 'https://tools.ailab.gc.cuny.edu/bibliography/__catalog-cache/';
const emptyReply = data => data === null || (typeof data === 'object' && ((Array.isArray(data.docs) && !data.docs.length) || (Array.isArray(data.message?.items) && !data.message.items.length) || (Array.isArray(data.search) && !data.search.length) || !Object.keys(data).length));
async function cacheKey(source, address) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}\n${address}`)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function createCatalogCache({ now = Date.now, edge = () => globalThis.caches?.default } = {}) {
  const memory = new Map();
  let bytes = 0;
  const drop = key => { const entry = memory.get(key); if (entry) { bytes -= entry.text.length; memory.delete(key); } };
  return {
    async get(key) {
      const entry = memory.get(key);
      if (entry && entry.expires > now()) { memory.delete(key); memory.set(key, entry); return { text: entry.text, layer: 'memory' }; }
      drop(key);
      try {
        const hit = await edge()?.match(new Request(CACHE_KEY_BASE + key));
        if (hit) return { text: await hit.text(), layer: 'edge' };
      } catch { /* the Cache API is an optimisation */ }
      return null;
    },
    async put(key, text, seconds) {
      drop(key);
      if (text.length <= CACHE_MAX_BYTES / 4) {
        memory.set(key, { text, expires: now() + seconds * 1000 });
        bytes += text.length;
        for (const oldest of memory.keys()) { if (bytes <= CACHE_MAX_BYTES && memory.size <= CACHE_MAX_ENTRIES) break; drop(oldest); }
      }
      try { await edge()?.put(new Request(CACHE_KEY_BASE + key), new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${seconds}` } })); } catch { /* best effort */ }
    },
  };
}

// fetchImpl reaches the public web (the catalogs above, enabled bibliography sites). Gateway calls go
// through env.GATEWAY, a service binding to the Gateway Worker (cail-model-api); tests may pass
// gatewayFetch, or a single fetchImpl for both.
export function createHandler({ fetchImpl, gatewayFetch, deadlineMs = DEADLINE_MS, catalogTimeoutMs = CATALOG_TIMEOUT_MS, cacheOptions } = {}) {
  const publicFetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const catalogFetch = createCatalogFetch(publicFetch);
  const lookupCache = createCatalogCache(cacheOptions);
  async function cachedCatalogFetch(source, address, limit, allowed, signal, googleKey, counts) {
    const key = await cacheKey(source, address);
    const hit = await lookupCache.get(key);
    if (hit) { counts[hit.layer]++; return JSON.parse(hit.text); }
    const data = await catalogFetch(address, limit, allowed, signal, googleKey);
    counts.miss++;
    await lookupCache.put(key, JSON.stringify(data), emptyReply(data) ? CACHE_EMPTY_SECONDS : CACHE_HIT_SECONDS);
    return data;
  }
  let binding = null;
  const viaBinding = (input, init) => {
    if (!binding) throw new TypeError('GATEWAY service binding is not configured.');
    return binding.fetch(input, init);
  };
  const client = createCailClient({ app: 'bibliography', fetchImpl: gatewayFetch ?? fetchImpl ?? viaBinding });
  // Per-isolate cache of catalog rows by model ID; the catalog is public and shared. Concurrent
  // requests share one read, which has its own short deadline and ignores any one caller's signal,
  // so a person cancelling their request cannot poison the cache. Only a failed read is held back
  // for 30 s; meanwhile models are treated as unlisted.
  let catalogCache = { at: 0, models: new Map() };
  let catalogRead = null;
  function catalogModels() {
    if (Date.now() - catalogCache.at <= CATALOG_CACHE_MS) return Promise.resolve(catalogCache.models);
    catalogRead ??= client.getCatalogSnapshot({ modality: 'all', signal: AbortSignal.timeout(catalogTimeoutMs) })
      .then(catalog => { catalogCache = { at: Date.now(), models: new Map(catalog.data.map(row => [row.id, row])) }; },
        () => { catalogCache = { at: Date.now() - CATALOG_CACHE_MS + CATALOG_RETRY_MS, models: new Map() }; })
      .then(() => catalogCache.models)
      .finally(() => { catalogRead = null; });
    return catalogRead;
  }
  async function catalogRow(model, signal) {
    signal.throwIfAborted();
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); });
    try { return (await Promise.race([catalogModels(), aborted])).get(model); }
    finally { signal.removeEventListener('abort', onAbort); }
  }
  // Output budget and reasoning controls for one parse or OCR call, from the model's catalog row.
  function modelControls(row, path, entries) {
    const contextCap = Number.isInteger(row?.context_length) && row.context_length > 0 ? Math.floor(row.context_length / 2) : Infinity;
    if (row?.capabilities.includes('reasoning')) {
      const expected = path === '/api/parse' ? OUTPUT_TOKENS_PER_ENTRY * entries : OCR_OUTPUT_TOKENS;
      // The Gateway rejects reasoning_effort for a model without the reasoning capability, so it is
      // sent only on the catalog's say-so; enable_thinking is a Workers AI chat-template switch.
      return { max_tokens: Math.min(REASONING_HEADROOM_TOKENS + expected, REASONING_MAX_TOKENS, contextCap), reasoning_effort: 'low', ...(row.provider === 'workers-ai' ? { chat_template_kwargs: { enable_thinking: false } } : {}) };
    }
    // Other non-reasoning routes keep their provider default, which is not known to be small.
    if (row && row.provider !== 'workers-ai') return {};
    return { max_tokens: Math.min(MAX_OUTPUT_TOKENS, contextCap) };
  }
  return async function handle(request, env) {
    if (env?.GATEWAY && typeof env.GATEWAY.fetch === 'function') binding = env.GATEWAY;
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    const suppliedId = request.headers.get('x-cail-request-id');
    const requestId = UUID.test(suppliedId || '') ? suppliedId : crypto.randomUUID();
    try {
      if (url.pathname === '/bibliography/health' && ['GET', 'HEAD'].includes(request.method)) return await readiness(env, client);
      // This Worker is binding-only. Doorway owns request-time Admission checks.
      // No public worker origin or application-credential fallback is exposed.
      const credential = await authenticate(request, env);
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw new AppError('method_not_allowed', 'Method not allowed.', 405);
      if (request.method === 'POST' && request.headers.get('origin') !== ORIGIN) throw new AppError('invalid_origin', 'Reload this tool from the CUNY AI Lab tools page.', 403);
      if (url.pathname === '/bibliography' && ['GET', 'HEAD'].includes(request.method)) {
        url.pathname = '/bibliography/';
        return new Response(null, { status: 308, headers: { location: url.href, 'cache-control': 'no-store' } });
      }
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
      const path = url.pathname.replace(/^\/bibliography/, '');
      if (path === '/api/session' && request.method === 'GET') return json({ authenticated: true });
      if (path === '/api/quota' && request.method === 'GET') return json(await client.getQuota(credential, { signal }));
      if (path === '/api/catalog' && request.method === 'GET') return json(await client.getCatalogSnapshot({ modality: 'all', signal }));
      if (path === '/api/enrich' && request.method === 'POST') {
        const query = enrichQuery(await bodyJSON(request));
        const allowed = env.CATALOG_HOSTS === undefined ? CATALOG_HOSTS : CATALOG_HOSTS.filter(host => String(env.CATALOG_HOSTS).split(',').map(value => value.trim()).includes(host));
        // undefined: no key (keyless, best effort); null: a key is set but malformed.
        const configured = typeof env.GOOGLE_BOOKS_API_KEY === 'string' ? env.GOOGLE_BOOKS_API_KEY.trim() : '';
        const googleKey = !configured ? undefined : GOOGLE_KEY.test(configured) ? configured : null;
        const counts = { memory: 0, edge: 0, miss: 0 };
        const result = await runLookup(query, (source, address, limit) => cachedCatalogFetch(source, address, limit, allowed, signal, googleKey, counts), { pause: ms => new Promise(resolve => setTimeout(resolve, ms)) });
        // Which cache layer answered (no data, no key): lets a release check confirm the Cache API works here.
        return json(result, 200, { 'x-catalog-cache': `memory=${counts.memory}, edge=${counts.edge}, miss=${counts.miss}` });
      }
      if (['/api/parse', '/api/ocr'].includes(path) && request.method === 'POST') {
        const body = await bodyJSON(request);
        if (!body || typeof body !== 'object') throw new AppError('invalid_request', 'The request could not be read.');
        const model = validateModel(body.model);
        let payload;
        if (path === '/api/parse') {
          if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100 || body.entries.some(e => !e || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) || typeof e.source !== 'string' || !e.source.trim() || e.source.length > 20000) || new Set(body.entries.map(e => e.id)).size !== body.entries.length) throw new AppError('invalid_entries', 'Provide 1–100 distinct citations, each under 20,000 characters.');
          payload = { model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: parsingPrompt }, { role: 'user', content: JSON.stringify(body.entries.map(e => ({ source_id: e.id, citation: e.source }))) }] };
        } else {
          if (typeof body.image !== 'string' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw new AppError('invalid_image', 'Provide one PDF page image.');
          payload = { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: ocrPrompt }, { type: 'image_url', image_url: { url: body.image } }] }] };
        }
        Object.assign(payload, modelControls(await catalogRow(model, signal), path, path === '/api/parse' ? body.entries.length : 1));
        const correlation = { request_id: requestId, trace_id: crypto.randomUUID().replaceAll('-', ''), span_id: crypto.randomUUID().replaceAll('-', '').slice(0, 16), trace_flags: 0 };
        const response = await client.chatCompletions(payload, credential, { signal, correlation });
        let data;
        try { data = JSON.parse(await boundedText(response)); } catch (error) { if (error instanceof AppError) throw error; throw new AppError('invalid_model_response', 'The model returned an unreadable response.', 502); }
        const content = data.choices?.[0]?.message?.content;
        if (data.choices?.[0]?.finish_reason === 'length') throw new AppError('model_output_limit', 'The model ran out of room before it finished. Try fewer entries per request.', 502);
        if (typeof content !== 'string' || !content.trim()) throw new AppError('invalid_model_response', 'The model returned an empty or incomplete response. Try a smaller batch.', 502);
        return json({ content, request_id: requestId });
      }
      if (path === '/api/source' && request.method === 'POST') {
        const body = await bodyJSON(request);
        let target;
        try { target = new URL(body?.url); } catch { throw new AppError('invalid_url', 'Enter a valid HTTPS bibliography URL.'); }
        const allowed = (env.SCRAPE_HOSTS || 'italianamericanimprints.omeka.net').split(',').map(s => s.trim());
        const safe = candidate => candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.port && allowed.includes(candidate.hostname);
        for (let redirects = 0; redirects < 4; redirects++) {
          if (!safe(target)) throw new AppError('unsupported_source', 'This website is not enabled for import. Paste its bibliography or upload a file.');
          const response = await publicFetch(target, { redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'text/html,text/plain' } });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) throw new AppError('source_redirect_invalid', 'The bibliography website sent an incomplete redirect.', 502);
            try { target = new URL(location, target); } catch { throw new AppError('source_redirect_invalid', 'The bibliography website sent an incomplete redirect.', 502); }
            continue;
          }
          if (!response.ok) { await response.body?.cancel(); throw new AppError('source_unavailable', 'The bibliography website could not be loaded.', 502); }
          const contentType = response.headers.get('content-type') || '';
          if (!/^(text\/html|text\/plain)/i.test(contentType)) { await response.body?.cancel(); throw new AppError('unsupported_source', 'This URL does not contain a webpage or text bibliography.'); }
          return json({ text: await boundedText(response, 2 * 1024 * 1024), html: /^text\/html/i.test(contentType) });
        }
        throw new AppError('source_unavailable', 'The website redirected too many times.', 502);
      }
      if (path.startsWith('/api/')) throw new AppError('not_found', 'Not found.', 404);
      if (!env.ASSETS || !['GET', 'HEAD'].includes(request.method)) throw new AppError('not_found', 'Not found.', 404);
      const assetURL = new URL(request.url);
      assetURL.pathname = path || '/';
      const asset = await env.ASSETS.fetch(new Request(assetURL, { method: request.method }));
      const response = new Response(asset.body, asset);
      response.headers.set('cache-control', 'no-store');
      response.headers.set('x-content-type-options', 'nosniff');
      response.headers.set('referrer-policy', 'no-referrer');
      response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      return response;
    } catch (error) {
      const known = error instanceof AppError || error instanceof CailError;
      const status = known ? (error.status >= 400 ? error.status : 502) : error.name === 'TimeoutError' ? 504 : error.name === 'AbortError' ? 499 : 502;
      const code = known ? error.code : status === 504 ? 'request_timeout' : status === 499 ? 'request_cancelled' : 'service_unavailable';
      const message = known ? (error.code === 'upstream_timeout' ? `${error.message} ${TIMEOUT_ADVICE}` : error.message) : status === 504 ? `The model did not finish within ${DEADLINE_MS / 60000} minutes. ${TIMEOUT_ADVICE}` : status === 499 ? 'The request was cancelled.' : 'The service is temporarily unavailable. Completed entries are preserved.';
      const retry = error instanceof CailError ? error.extras.should_retry : status === 503;
      const retryAfter = error instanceof CailError ? error.extras.retry_after_seconds : undefined;
      return json({ error: { code, message, request_id: requestId, ...(status === 401 ? { launch: LAUNCH_PATH } : {}) } }, status, { 'x-should-retry': retry === true ? 'true' : 'false', 'x-cail-request-id': requestId, ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { 'retry-after': String(retryAfter) } : {}) });
    }
  };
}

export default { fetch: createHandler() };
