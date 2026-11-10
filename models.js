// Model menus built from the CAIL catalog. Pure so it can be tested without a DOM.
// Owner decision 2026-11-09: offer only Gateway-recommended rows with the needed capability.
// Any other Gateway model stays reachable through "Other Gateway model ID".
export const FALLBACK_PARSE = [
  { id: 'gpt-oss-120b', label: 'GPT OSS 120B · CAIL default' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' }
];
export const FALLBACK_VISION = [
  { id: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' }
];
export const PREFERRED_PARSE = ['gpt-oss-120b'];
export const PREFERRED_VISION = ['qwen3-vl-235b-a22b-instruct', 'gemma-4-26b-a4b-it'];
// A 25-entry parse batch is a few thousand input tokens; the Worker asks for up to 16,000 output
// tokens, capped at half the context. 32,000 tokens holds both with room to spare.
export const MIN_CONTEXT_TOKENS = 32000;
// Safety classifiers answer "safe"/"unsafe", not CSL-JSON, even when tagged text-generation.
const CLASSIFIER = /guard|safeguard/i;
const known = new Map(FALLBACK_PARSE.map(model => [model.id, model.label]));
const offered = (row, wanted) => typeof row?.id === 'string' && row.recommended === true && (row.status === undefined || row.status === 'active')
  && Array.isArray(row.capabilities) && wanted.every(capability => row.capabilities.includes(capability))
  && Number.isInteger(row.context_length) && row.context_length >= MIN_CONTEXT_TOKENS
  && !CLASSIFIER.test(row.id) && !CLASSIFIER.test(typeof row.name === 'string' ? row.name : '');
const rows = (catalog, wanted) => (Array.isArray(catalog?.data) ? catalog.data : [])
  .filter(row => offered(row, wanted))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(row => ({ id: row.id, label: known.get(row.id) || (typeof row.name === 'string' && row.name) || row.id }));

// Falls back to the built-in IDs whenever the catalog is missing or has no matching rows.
export function modelMenus(catalog) {
  const parse = rows(catalog, ['text-generation']);
  const vision = rows(catalog, ['text-generation', 'vision']);
  // Suggestions for the free-text field: every text-generation row, whatever its tier.
  const suggestions = (Array.isArray(catalog?.data) ? catalog.data : [])
    .filter(row => typeof row?.id === 'string' && Array.isArray(row.capabilities) && row.capabilities.includes('text-generation'))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(row => ({ id: row.id, label: (typeof row.name === 'string' && row.name) || row.id }));
  return { parse: parse.length ? parse : FALLBACK_PARSE, vision: vision.length ? vision : FALLBACK_VISION, suggestions };
}

// Keep the current selection only while it is still offered; otherwise the first preferred model
// that is offered, otherwise the first option.
export function chooseModel(current, values, preferred = []) {
  if (values.includes(current)) return current;
  return preferred.find(id => values.includes(id)) ?? values[0];
}
