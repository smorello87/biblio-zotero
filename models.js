// Model menus built from the CAIL catalog. Pure so it can be tested without a DOM.
export const FALLBACK_PARSE = [
  { id: 'gpt-oss-120b', label: 'GPT OSS 120B · CAIL default' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' }
];
export const FALLBACK_VISION = [
  { id: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen 3 VL 235B · best for scans' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' }
];
const known = new Map(FALLBACK_PARSE.map(model => [model.id, model.label]));
const rows = (catalog, wanted) => (Array.isArray(catalog?.data) ? catalog.data : [])
  .filter(row => typeof row?.id === 'string' && Array.isArray(row.capabilities) && wanted.every(capability => row.capabilities.includes(capability)))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(row => ({ id: row.id, label: known.get(row.id) || row.name || row.id }));

// Falls back to the built-in IDs whenever the catalog is missing or has no matching rows.
export function modelMenus(catalog) {
  const parse = rows(catalog, ['text-generation']);
  const vision = rows(catalog, ['text-generation', 'vision']);
  return { parse: parse.length ? parse : FALLBACK_PARSE, vision: vision.length ? vision : FALLBACK_VISION };
}
