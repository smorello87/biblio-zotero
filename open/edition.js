// Open edition: an OpenAI-compatible endpoint the person chooses, with their own key, kept in this
// browser only. scripts/build-open.mjs bundles this file in place of ../edition.js.
import { createOpenApi, endpointBase, PROVIDERS, DEFAULT_PROVIDER, OPEN_PARSE, OPEN_VISION } from './api.js';
import { modelMenus as catalogMenus } from '../models.js';

const CONFIG = 'bibliography-endpoint';
const KEY = provider => `bibliography-key:${provider}`;

export const copy = {
  otherModel: 'Other model ID',
  visionImage: 'The image will be sent to the selected vision model at your chosen endpoint.',
  visionPdf: 'OCR sends each page image to the selected vision model at your chosen endpoint. Leave it off for PDFs with selectable text.',
};

// OpenRouter falls back to the curated open-weight list; other endpoints offer only what they list,
// and every listed model in both menus (their lists do not say which models read images).
export function modelMenus(catalog) {
  if (config.provider === 'openrouter') return catalogMenus(catalog, { fallbackParse: OPEN_PARSE, fallbackVision: OPEN_VISION });
  const menus = catalogMenus(catalog, { fallbackParse: [], fallbackVision: [] });
  return { ...menus, vision: menus.vision.length ? menus.vision : menus.parse };
}

// Storage can be missing or throw (private windows, blocked site data); settings then live only in
// this page until it is reloaded.
const safely = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const local = () => safely(() => globalThis.localStorage, null);
const session = () => safely(() => globalThis.sessionStorage, null);
const memoryKeys = new Map();
function loadConfig() {
  const saved = safely(() => JSON.parse(local()?.getItem(CONFIG) || 'null'), null);
  const provider = PROVIDERS[saved?.provider] ? saved.provider : DEFAULT_PROVIDER;
  return { provider, bases: typeof saved?.bases === 'object' && saved.bases ? saved.bases : {} };
}
let config = loadConfig();
const saveConfig = () => safely(() => local()?.setItem(CONFIG, JSON.stringify(config)));
const baseFor = provider => PROVIDERS[provider].editable ? (config.bases[provider] ?? PROVIDERS[provider].base) : PROVIDERS[provider].base;
function readKey(provider) {
  if (memoryKeys.has(provider)) return memoryKeys.get(provider);
  for (const store of [local(), session()]) { const value = safely(() => store?.getItem(KEY(provider)), null); if (value) { memoryKeys.set(provider, value); return value; } }
  return '';
}
function writeKey(provider, value, remember) {
  memoryKeys.set(provider, value);
  for (const store of [local(), session()]) safely(() => store?.removeItem(KEY(provider)));
  if (value) safely(() => (remember ? local() : session())?.setItem(KEY(provider), value));
}
const remembered = provider => Boolean(safely(() => local()?.getItem(KEY(provider)), null));

export function createEditionApi() {
  return createOpenApi({ getConfig: () => ({ provider: config.provider, base: baseFor(config.provider), key: readKey(config.provider) }) });
}

// The site's light/dark setting (stefanomorello.com stores it as localStorage "theme").
function setupTheme(button) {
  const apply = theme => { document.documentElement.setAttribute('data-theme', theme); button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); button.setAttribute('aria-pressed', String(theme === 'dark')); };
  apply(safely(() => local()?.getItem('theme'), null) === 'dark' ? 'dark' : 'light');
  button.addEventListener('click', () => { const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; apply(next); safely(() => local()?.setItem('theme', next)); });
}

export function setup({ $, refresh }) {
  setupTheme($('theme-toggle'));
  const select = $('provider-select'), base = $('base-url-field'), field = $('key-field'), feedback = $('key-feedback');
  select.replaceChildren(...Object.entries(PROVIDERS).map(([id, preset]) => { const option = document.createElement('option'); option.value = id; option.textContent = preset.label; return option; }));
  function show() {
    const preset = PROVIDERS[config.provider];
    select.value = config.provider;
    $('base-url-row').hidden = !preset.editable;
    base.value = baseFor(config.provider);
    $('key-optional').hidden = !preset.keyOptional;
    field.value = '';
    field.placeholder = readKey(config.provider) ? 'Key saved in this browser' : preset.keyPrefix ? `${preset.keyPrefix}…` : preset.keyOptional ? 'Leave blank if the server needs none' : 'Paste your API key';
    $('remember-key').checked = remembered(config.provider);
    const link = $('key-link');
    link.hidden = !preset.keyUrl;
    if (preset.keyUrl) { link.href = preset.keyUrl; link.textContent = `Get your ${preset.label} API key ↗`; }
    $('local-help').hidden = config.provider !== 'local';
  }
  show();
  select.addEventListener('change', () => { config.provider = select.value; saveConfig(); feedback.textContent = ''; show(); refresh(); });
  $('key-form').addEventListener('submit', event => {
    event.preventDefault();
    const preset = PROVIDERS[config.provider];
    if (preset.editable) {
      const clean = endpointBase(base.value);
      if (!clean) { feedback.textContent = 'Use an https:// address, or http://localhost for a server on this computer.'; return; }
      config.bases[config.provider] = clean; saveConfig();
    }
    const value = field.value.trim() || readKey(config.provider);
    if (value && /\s/.test(value)) { feedback.textContent = 'The key contains spaces. Copy it again from your provider.'; return; }
    if (value && preset.keyPrefix && !value.startsWith(preset.keyPrefix)) { feedback.textContent = `${preset.label} keys start with ${preset.keyPrefix}. Copy the whole key.`; return; }
    if (!value && !preset.keyOptional) { feedback.textContent = `Paste your ${preset.label} API key.`; return; }
    writeKey(config.provider, value, $('remember-key').checked);
    show();
    feedback.textContent = !value ? 'Endpoint saved.' : $('remember-key').checked ? 'Saved on this device.' : 'Saved for this tab only.';
    refresh();
  });
  $('forget-key').addEventListener('click', () => { writeKey(config.provider, '', false); show(); feedback.textContent = 'Key removed from this browser.'; refresh(); });
}

// The account panel: which endpoint is in use, and, for OpenRouter, what it reports for the key.
export async function refreshStatus(api, { $, text }) {
  $('refresh-quota').disabled = true;
  const preset = PROVIDERS[config.provider];
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
  try {
    const { authenticated } = await api('session');
    if (!authenticated) {
      $('session-status').textContent = preset.editable && !endpointBase(baseFor(config.provider)) ? 'No endpoint URL' : 'No key saved';
      $('quota-content').replaceChildren(text('p', 'You can prepare and review your bibliography now. Conversion and OCR need an endpoint and, for most services, an API key.', 'help'));
      return;
    }
    $('session-status').textContent = `Using ${config.provider === 'custom' ? new URL(endpointBase(baseFor('custom'))).host : config.provider === 'local' ? new URL(endpointBase(baseFor('local'))).host : preset.label}`;
    try {
      const key = await api('quota');
      if (!key) { $('quota-content').replaceChildren(text('p', 'Requests go from this browser straight to this endpoint and are billed by it.', 'help')); return; }
      const lines = [];
      if (typeof key.limit_remaining === 'number') lines.push(text('p', `${money(key.limit_remaining)} left on this key`, 'quota-number'));
      if (typeof key.usage === 'number') lines.push(text('p', `${money(key.usage)} used${typeof key.limit === 'number' ? ` of a ${money(key.limit)} key limit` : ''}`, 'help'));
      lines.push(text('p', 'As reported by OpenRouter. Account credits are shown at openrouter.ai/credits.', 'help'));
      $('quota-content').replaceChildren(...lines);
    } catch (error) {
      $('quota-content').replaceChildren(text('p', error.code === 'invalid_key' ? error.message : 'Usage is unavailable right now. You can still try a conversion.', 'help'));
    }
  } finally { $('refresh-quota').disabled = false; }
}
