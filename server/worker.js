import { CAIL_CANONICAL_ISSUER, loadIdentityVerifierConfig, readIdentityKeyring, verifyIdentityJwt, verifyKeyringGatewayJwt } from '@cuny-ai-lab/cail-identity';
import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { parsingPrompt, ocrPrompt } from './prompts.js';

const ORIGIN = 'https://tools.ailab.gc.cuny.edu';
const AUDIENCE = 'cail:bibliography';
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

async function readiness(env) {
  await verifierConfigs(env);
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

export function createHandler({ fetchImpl = fetch, deadlineMs = DEADLINE_MS, catalogTimeoutMs = CATALOG_TIMEOUT_MS } = {}) {
  const client = createCailClient({ app: 'bibliography', fetchImpl });
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
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    const suppliedId = request.headers.get('x-cail-request-id');
    const requestId = UUID.test(suppliedId || '') ? suppliedId : crypto.randomUUID();
    try {
      if (url.pathname === '/bibliography/health' && ['GET', 'HEAD'].includes(request.method)) return await readiness(env);
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
        const body = await bodyJSON(request);
        if (typeof body?.title !== 'string' || body.title.length > 500 || typeof body?.author !== 'string' || body.author.length > 250) throw new AppError('invalid_request', 'Provide a title and author for library lookup.');
        const query = new URLSearchParams({ title: body.title, author: body.author, limit: '5' });
        if (Number.isInteger(body.year) && body.year > 0) query.set('first_publish_year', String(body.year));
        const response = await fetchImpl(`https://openlibrary.org/search.json?${query}`, { redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'application/json' } });
        if (!response.ok || response.status >= 300) { await response.body?.cancel(); throw new AppError('enrichment_unavailable', 'Library metadata was unavailable.', 502); }
        let result;
        try { result = JSON.parse(await boundedText(response, 1024 * 1024)); } catch { throw new AppError('enrichment_unavailable', 'Library metadata was unavailable.', 502); }
        const match = result?.docs?.[0];
        if (!match) return json({ suggestion: null });
        // Every suggested value is merged into a CSL-JSON record on acceptance, so only short strings pass.
        const first = (value, pattern = /\S/) => (Array.isArray(value) ? value : []).find(item => typeof item === 'string' && item.length <= 300 && pattern.test(item));
        const fields = {};
        const isbn = first(match.isbn, /^\d{13}$/) || first(match.isbn, /^\d{9}[\dX]$/);
        if (isbn) fields.ISBN = isbn;
        const oclc = first(match.oclc, /^\d{1,20}$/);
        if (oclc) fields.OCLC = oclc;
        const lccn = first(match.lccn, /^[a-z]{0,3}\d{1,12}$/);
        if (lccn) fields['call-number'] = lccn;
        const publisher = first(match.publisher);
        if (publisher) fields.publisher = publisher;
        const place = first(match.publish_place);
        if (place) fields['publisher-place'] = place;
        if (Number.isSafeInteger(match.number_of_pages_median) && match.number_of_pages_median > 0) fields['number-of-pages'] = String(match.number_of_pages_median);
        const title = typeof match.title === 'string' && match.title.trim() && match.title.length <= 500 ? match.title : body.title;
        return json({ suggestion: { title, url: typeof match.key === 'string' && /^\/works\/OL\d+W$/.test(match.key) ? `https://openlibrary.org${match.key}` : 'https://openlibrary.org', fields } });
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
          const response = await fetchImpl(target, { redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'text/html,text/plain' } });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) break;
            target = new URL(location, target);
            continue;
          }
          if (!response.ok) throw new AppError('source_unavailable', 'The bibliography website could not be loaded.', 502);
          const contentType = response.headers.get('content-type') || '';
          if (!/^(text\/html|text\/plain)/i.test(contentType)) throw new AppError('unsupported_source', 'This URL does not contain a webpage or text bibliography.');
          return json({ text: await boundedText(response, 2 * 1024 * 1024), html: contentType.includes('text/html') });
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
      return json({ error: { code, message, request_id: requestId } }, status, { 'x-should-retry': retry === true ? 'true' : 'false', 'x-cail-request-id': requestId, ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { 'retry-after': String(retryAfter) } : {}) });
    }
  };
}

export default { fetch: createHandler() };
