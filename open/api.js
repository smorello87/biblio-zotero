// Open edition API client. Same contract as ../api.js (api(path, body, signal) resolving to the
// Worker's JSON), but everything runs in the browser: conversion and OCR go to an OpenAI-compatible
// endpoint the person chooses (with their own key), and catalog lookups go straight to the catalogs.
// Free of DOM access so it can be tested.
import { parsingPrompt, ocrPrompt } from '../server/prompts.js';
import { runLookup, SourceError } from '../server/lookup.js';
import { validateItem } from '../core.js';

// Endpoints people can pick. Every preset was checked (2026-11-13) to answer cross-origin requests
// from a browser. The CUNY AI Lab Gateway does not, so CUNY users are pointed to the CAIL edition.
// style: which request parameters the endpoint accepts (see controlsFor). prefer: the model chosen by
// default from the endpoint's own list, when nothing else is chosen.
export const PROVIDERS = {
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-', style: 'openrouter' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', style: 'openai', prefer: /^gpt-[\d.]+-mini$/ },
  gemini: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', prefer: /gemini-[\d.]+-flash$/ },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', prefer: /gpt-oss-120b/ },
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', prefer: /^mistral-small-latest$/ },
  together: { label: 'Together AI', base: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys', prefer: /deepseek-v4|gpt-oss-120b/i },
  local: { label: 'Local server (Ollama, LM Studio…)', base: 'http://localhost:11434/v1', editable: true, keyOptional: true },
  custom: { label: 'Other OpenAI-compatible endpoint', base: '', editable: true, keyOptional: true },
};
export const DEFAULT_PROVIDER = 'openrouter';
// Used only when OpenRouter's model list cannot be read. The first entry is the default.
export const OPEN_PARSE = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
  { id: 'google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'qwen/qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' },
];
export const OPEN_VISION = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'qwen/qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' },
];
// Output budgets, as in server/worker.js.
const MAX_OUTPUT_TOKENS = 16000;
const REASONING_HEADROOM_TOKENS = 4000;
const REASONING_MAX_TOKENS = 10000;
const OUTPUT_TOKENS_PER_ENTRY = 250;
const OCR_OUTPUT_TOKENS = 4000;
const BROWSER_TIMEOUT_MS = 185000;
const MODELS_CACHE_MS = 10 * 60 * 1000;
// Models a /models list can include that cannot answer a chat request.
const NOT_CHAT = /embed|tts|whisper|transcri|dall-e|image|moderation|realtime|audio|search|guard|rerank|veo|imagen|lyria|aqa/i;
const CATALOG_HOSTS = ['openlibrary.org', 'api.crossref.org', 'www.googleapis.com', 'www.wikidata.org'];
const CATALOG_TIMEOUT_PER_SOURCE_MS = 8000;
const RETRYABLE_CODES = new Set(['invalid_model_response', 'model_output_limit', 'request_timeout', 'upstream_timeout', 'network_error', 'rate_limited']);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, shouldRetry: RETRYABLE_CODES.has(code), ...extra });

// An endpoint base URL: HTTPS anywhere, or plain HTTP only on this computer. Returns it without a
// trailing slash, or null.
export function endpointBase(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, '');
}

// Model families offered in the menus: open-weight models, as in the Zotero Metadata Assistant.
// Every model of a family's current generation is offered (the highest major version the endpoint
// lists), newest first, so new releases appear without a code change. Dated snapshots, previews
// and experimental or "thinking" variants are left out. Other models stay reachable through
// "Other model ID", whose suggestions list everything the endpoint has.
export const FAMILIES = [
  { name: 'DeepSeek', match: /deepseek-v(\d+)/i },
  { name: 'GPT OSS', match: /gpt-oss-\d+b/i },
  { name: 'Gemma', match: /gemma-?(\d+)/i },
  { name: 'Qwen VL', match: /qwen(\d+)(?:\.\d+)?-?vl/i },
];
const VARIANT = /[-_]\d{4}(?:$|[-_])|latest|[-_]exp(?:$|[-_])|thinking|preview/i;
// The default: the newest DeepSeek Flash, the lower-cost DeepSeek model.
const DEFAULT_MODEL = /deepseek-v[\d.]+-flash$/i;

// Picks the current-generation family members from a list of rows ({id, created?}) and returns them
// in menu order: by family, the default first, then newest (or, without dates, by name).
export function familyModels(rows) {
  const picked = [];
  FAMILIES.forEach((family, rank) => {
    const members = rows.filter(row => family.match.test(row.id) && !VARIANT.test(row.id) && !NOT_CHAT.test(row.id));
    const generation = row => Number(family.match.exec(row.id)?.[1] ?? 0);
    const current = Math.max(0, ...members.map(generation));
    members.filter(row => generation(row) === current)
      .sort((a, b) => Number(DEFAULT_MODEL.test(b.id)) - Number(DEFAULT_MODEL.test(a.id)) || (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
      .forEach(row => picked.push({ ...row, family: family.name, rank }));
  });
  return picked;
}

// OpenRouter's model list, reshaped into the CAIL catalog rows that ../models.js reads. The family
// models are "recommended" (the menus); every text model is offered as a suggestion. OpenRouter
// says which models read images, so the vision menu holds only those.
export function catalogFromOpenRouter(data) {
  const rows = (Array.isArray(data?.data) ? data.data : []).filter(row => typeof row?.id === 'string' && !row.id.includes(':') && !row.id.startsWith('~'));
  const order = new Map(familyModels(rows).map((row, index) => [row.id, index]));
  return {
    data: rows.map(row => {
      const inputs = Array.isArray(row.architecture?.input_modalities) ? row.architecture.input_modalities : [];
      const outputs = Array.isArray(row.architecture?.output_modalities) ? row.architecture.output_modalities : ['text'];
      const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
      return {
        id: row.id, name: typeof row.name === 'string' ? row.name.replace(/^[^:]{1,40}:\s*/, '') : row.id,
        recommended: order.has(row.id), order: order.get(row.id) ?? order.size,
        context_length: Number.isInteger(row.context_length) ? row.context_length : 0,
        capabilities: [...(outputs.includes('text') ? ['text-generation'] : []), ...(inputs.includes('image') ? ['vision'] : []), ...(params.includes('reasoning') ? ['reasoning'] : [])],
        json: params.includes('response_format'),
      };
    }),
  };
}

// Any other endpoint's /models list ({data: [{id}]}, as OpenAI, Ollama and LM Studio return). When
// it carries the families (Groq, Together, a local server), the menus offer those; otherwise (OpenAI,
// Gemini, Mistral) every chat model, the provider's preferred one first. These lists say nothing about
// images, so both menus get the same models and the person checks one reads images before OCR.
export function catalogFromModelList(data, provider) {
  const prefer = PROVIDERS[provider]?.prefer;
  const ids = [...new Set((Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []).map(row => row?.id ?? row?.name).filter(id => typeof id === 'string' && id && id.length <= 200 && !NOT_CHAT.test(id)))];
  ids.sort((a, b) => Number(prefer?.test(b) ?? 0) - Number(prefer?.test(a) ?? 0) || a.localeCompare(b));
  const families = familyModels(ids.map(id => ({ id }))).map(row => row.id);
  const offered = families.length ? families : ids;
  const rest = ids.filter(id => !offered.includes(id));
  return { data: [...offered, ...rest].map((id, order) => ({ id, name: id.replace(/^models\//, ''), recommended: offered.includes(id), order, context_length: 1_000_000, capabilities: ['text-generation', 'vision'] })) };
}

// Request parameters for one call. OpenRouter: output budget and reasoning from the model's row.
// OpenAI: its reasoning models refuse temperature and max_tokens. Others: provider defaults.
export function controlsFor(style, row, path, entries) {
  if (style === 'openai') return { max_completion_tokens: MAX_OUTPUT_TOKENS };
  if (style !== 'openrouter') return { temperature: 0 };
  const contextCap = Number.isInteger(row?.context_length) && row.context_length > 0 ? Math.floor(row.context_length / 2) : Infinity;
  if (row?.capabilities.includes('reasoning')) {
    const expected = path === 'parse' ? OUTPUT_TOKENS_PER_ENTRY * entries : OCR_OUTPUT_TOKENS;
    return { temperature: 0, max_tokens: Math.min(REASONING_HEADROOM_TOKENS + expected, REASONING_MAX_TOKENS, contextCap), reasoning: { effort: 'low', exclude: true } };
  }
  return { temperature: 0, max_tokens: Math.min(MAX_OUTPUT_TOKENS, contextCap) };
}
export const modelControls = (row, path, entries) => controlsFor('openrouter', row, path, entries);

// One catalog request from the browser: the four catalog hosts over HTTPS only, its own deadline,
// bounded reply. Returns parsed JSON, null for 404, or throws a SourceError; a caller abort
// propagates. Wikidata answers cross-origin requests only with origin=*.
export function createCatalogFetch(fetchImpl) {
  return async function catalogFetch(source, address, limit, signal) {
    const target = new URL(address);
    if (target.protocol !== 'https:' || !CATALOG_HOSTS.includes(target.hostname)) throw new SourceError('disabled');
    if (target.hostname === 'www.wikidata.org') target.searchParams.set('origin', '*');
    const deadline = AbortSignal.timeout(CATALOG_TIMEOUT_PER_SOURCE_MS);
    const both = AbortSignal.any([signal, deadline]);
    let response;
    try { response = await fetchImpl(target, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: both, headers: { accept: 'application/json' } }); }
    catch (error) { if (signal.aborted) throw error; throw new SourceError(deadline.aborted ? 'timeout' : 'network'); }
    if (response.url && !CATALOG_HOSTS.includes(new URL(response.url).hostname)) throw new SourceError('redirect');
    if (response.status === 404) return null;
    if (!response.ok) throw new SourceError('status', response.status);
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) throw new SourceError('unreadable');
    if (Number(response.headers.get('content-length')) > limit) throw new SourceError('too_large');
    let text;
    try { text = await response.text(); }
    catch (error) { if (signal.aborted) throw error; throw new SourceError(deadline.aborted ? 'timeout' : 'network'); }
    if (text.length > limit) throw new SourceError('too_large');
    try { return JSON.parse(text); } catch { throw new SourceError('unreadable'); }
  };
}

const lookupString = (value, max) => value === undefined || value === null || value === '' ? undefined : typeof value === 'string' && value.length <= max ? value.trim() : null;
function enrichQuery(body) {
  const fields = { title: lookupString(body?.title, 500), author: lookupString(body?.author, 250), container: lookupString(body?.container, 500), url: lookupString(body?.url, 2000), doi: lookupString(body?.doi, 250), isbn: lookupString(body?.isbn, 40) };
  const yearOk = value => value === undefined || value === null || (Number.isInteger(value) && value > 0 && value < 3000);
  if (!body || typeof body !== 'object' || !validateItem({ type: body.type, title: 'x' }) || !fields.title || Object.values(fields).includes(null) || !yearOk(body.year) || !yearOk(body.yearEnd)) throw fail('invalid_request', 'Provide the entry type, title and optional creator, year and identifiers for catalog lookup.');
  return { type: body.type, ...fields, author: fields.author || '', year: body.year ?? undefined, yearEnd: body.yearEnd ?? undefined };
}

// Turns an endpoint's error reply into the error shape browser.js shows.
async function endpointError(response, label) {
  let message = '';
  try { const body = await response.json(); message = (Array.isArray(body) ? body[0] : body)?.error?.message || ''; } catch { /* status alone */ }
  const retryAfter = Number(response.headers.get('retry-after'));
  const extra = { status: response.status, detail: message, ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) };
  if (response.status === 401 || response.status === 403) return fail('invalid_key', `${label} did not accept this API key. Check it under Model endpoint.`, extra);
  if (response.status === 402) return fail('insufficient_credits', `Your ${label} account is out of credits, or this key has reached its limit.`, extra);
  if (response.status === 404) return fail('not_found', `${label} did not recognise this request. Check the endpoint URL and model ID.${message ? ` (${message})` : ''}`, { ...extra, shouldRetry: false });
  if (response.status === 429) return fail('rate_limited', `${label} is rate-limiting this key or model. Wait a moment, or try another model.`, extra);
  if (response.status === 408 || response.status === 504) return fail('upstream_timeout', 'The model took too long to answer. Try fewer entries per request or another model.', extra);
  return fail('upstream_error', `${label} could not complete the request${message ? `: ${message}` : '.'}`, { ...extra, shouldRetry: response.status >= 500 });
}

// getConfig() returns { provider, base, key } for the endpoint chosen on the page.
export function createOpenApi({ getConfig, fetchImpl = (...args) => fetch(...args), now = Date.now, randomUUID = () => crypto.randomUUID(), pause } = {}) {
  const catalogFetch = createCatalogFetch(fetchImpl);
  let models = null;
  function endpoint({ needKey = true } = {}) {
    const config = getConfig() || {};
    const preset = PROVIDERS[config.provider] || PROVIDERS[DEFAULT_PROVIDER];
    const provider = PROVIDERS[config.provider] ? config.provider : DEFAULT_PROVIDER;
    const base = endpointBase(preset.editable ? config.base : preset.base);
    if (!base) throw fail('invalid_endpoint', 'Enter the endpoint URL under Model endpoint: an https:// address, or http://localhost for a server on this computer.', { shouldRetry: false });
    const key = typeof config.key === 'string' ? config.key.trim() : '';
    if (needKey && !key && !preset.keyOptional) throw fail('missing_key', `Add your ${preset.label} API key under Model endpoint to convert or use OCR.`, { status: 401, shouldRetry: false });
    const headers = { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
    return { provider, preset, base, key, headers, label: preset.editable && provider === 'custom' ? new URL(base).host : preset.label };
  }
  async function catalog(signal) {
    const target = endpoint({ needKey: false });
    // OpenRouter lists its models publicly; other endpoints need the key first.
    if (target.provider !== 'openrouter' && !target.key && !target.preset.keyOptional) return { data: [] };
    const cacheKey = `${target.provider} ${target.base} ${target.key}`;
    if (models?.cacheKey === cacheKey && now() - models.at <= MODELS_CACHE_MS) return models.catalog;
    let response;
    try { response = await fetchImpl(`${target.base}/models`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal, headers: target.provider === 'openrouter' ? { accept: 'application/json' } : target.headers }); }
    catch (error) { if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw error; throw fail('network_error', `${target.label} could not be reached to list its models.${target.provider === 'local' ? ' Check that the server is running and allows requests from this site.' : ''}`); }
    if (!response.ok) throw await endpointError(response, target.label);
    const data = await response.json();
    models = { cacheKey, at: now(), catalog: target.provider === 'openrouter' ? catalogFromOpenRouter(data) : catalogFromModelList(data, target.provider) };
    return models.catalog;
  }
  async function rowFor(model, signal) {
    try { return (await catalog(signal)).data.find(row => row.id === model); }
    catch (error) { if (signal.aborted) throw error; return undefined; }
  }
  async function send(target, payload, signal, requestId) {
    try {
      return await fetchImpl(`${target.base}/chat/completions`, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        // Only OpenRouter gets the attribution header: other servers may refuse unknown headers.
        headers: { ...target.headers, 'content-type': 'application/json', ...(target.provider === 'openrouter' ? { 'x-title': 'Bibliography to Zotero (open edition)' } : {}) },
        body: JSON.stringify(payload), signal,
      });
    } catch (error) {
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw error;
      const timedOut = error?.name === 'TimeoutError' || signal.reason?.name === 'TimeoutError';
      throw fail(timedOut ? 'request_timeout' : 'network_error', timedOut ? 'The request took longer than 3 minutes. Completed entries are preserved. Try fewer entries per request or another model.' : `${target.label} could not be reached. Check your connection${target.provider === 'local' || target.provider === 'custom' ? ', the endpoint URL, and that the server allows requests from this site' : ''}, then try again.`, { requestId });
    }
  }
  async function complete(path, body, signal) {
    if (!body || typeof body !== 'object') throw fail('invalid_request', 'The request could not be read.');
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model || model.length > 200 || /\s/.test(model)) throw fail('invalid_model', path === 'ocr' ? 'Choose a vision model. This endpoint did not list any models, so OCR is unavailable with it.' : 'Choose a model, or enter the model ID your endpoint uses.', { shouldRetry: false });
    const target = endpoint();
    let payload;
    if (path === 'parse') {
      if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100 || body.entries.some(e => !e || typeof e.id !== 'string' || typeof e.source !== 'string' || !e.source.trim() || e.source.length > 20000)) throw fail('invalid_entries', 'Provide 1–100 citations, each under 20,000 characters.');
      payload = { model, messages: [{ role: 'system', content: parsingPrompt }, { role: 'user', content: JSON.stringify(body.entries.map(e => ({ source_id: e.id, citation: e.source }))) }] };
    } else {
      if (typeof body.image !== 'string' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw fail('invalid_image', 'Provide one PDF page image.');
      payload = { model, messages: [{ role: 'user', content: [{ type: 'text', text: ocrPrompt }, { type: 'image_url', image_url: { url: body.image } }] }] };
    }
    const row = target.provider === 'openrouter' ? await rowFor(model, signal) : undefined;
    if (path === 'parse' && row?.json !== false) payload.response_format = { type: 'json_object' };
    Object.assign(payload, controlsFor(target.preset.style, row, path, path === 'parse' ? body.entries.length : 1));
    const requestId = randomUUID();
    let response = await send(target, payload, signal, requestId);
    // A 400 often means the server does not take one of the optional parameters (JSON mode, a
    // temperature, an output budget). Try once more with only the model and messages.
    const optional = ['response_format', 'temperature', 'max_tokens', 'max_completion_tokens', 'reasoning'].filter(name => name in payload);
    if (response.status === 400 && optional.length) {
      await response.body?.cancel();
      response = await send(target, { model, messages: payload.messages }, signal, requestId);
    }
    if (!response.ok) throw Object.assign(await endpointError(response, target.label), { requestId });
    let data;
    try { data = await response.json(); } catch { throw fail('invalid_model_response', 'The model returned an unreadable response.', { requestId }); }
    // OpenRouter can answer 200 with an error object when the provider fails mid-request.
    if (data?.error) throw fail('upstream_error', `${target.label} could not complete the request${data.error.message ? `: ${data.error.message}` : '.'}`, { requestId, shouldRetry: true });
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw fail('model_output_limit', 'The model ran out of room before it finished. Try fewer entries per request.', { requestId });
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw fail('invalid_model_response', 'The model returned an empty or incomplete response. Try a smaller batch.', { requestId });
    return { content, request_id: typeof data.id === 'string' ? data.id : requestId };
  }

  return async function api(path, body, signal) {
    const both = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(BROWSER_TIMEOUT_MS)]);
    if (path === 'session') { try { endpoint(); return { authenticated: true }; } catch { return { authenticated: false }; } }
    if (path === 'catalog') return catalog(both);
    if (path === 'quota') {
      // Only OpenRouter reports a key's usage; for other endpoints there is nothing to show.
      const target = endpoint();
      if (target.provider !== 'openrouter') return null;
      const response = await fetchImpl(`${target.base}/key`, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: both, headers: target.headers });
      if (!response.ok) throw await endpointError(response, target.label);
      return (await response.json())?.data ?? {};
    }
    if (path === 'parse' || path === 'ocr') return complete(path, body, both);
    if (path === 'enrich') return runLookup(enrichQuery(body), (source, address, limit) => catalogFetch(source, address, limit, both), pause ? { pause } : undefined);
    if (path === 'source') throw fail('unsupported_source', 'Website import is available only in the CUNY AI Lab edition. Paste the bibliography or upload a file.', { shouldRetry: false });
    throw fail('not_found', 'Not found.', { status: 404 });
  };
}
