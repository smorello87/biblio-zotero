// Records the Wikidata coverage survey: runs each query below through the real lookup against the
// live Wikidata API once (politely: identified User-Agent, sequential, paused), and writes trimmed
// replies to tests/fixtures/wikidata-survey.json so tests can replay them offline.
// Usage: node scripts/record-wikidata-survey.mjs   (network; not part of npm test)
import { writeFile } from 'node:fs/promises';
import { runLookup } from '../server/lookup.js';
import { SURVEY } from '../tests/fixtures/wikidata-survey-queries.mjs';

const USER_AGENT = 'CUNY-AI-Lab-Bibliography/1.0 (https://tools.ailab.gc.cuny.edu/bibliography/; ailab@gc.cuny.edu)';
const KEEP = new Set(['P31', 'P1476', 'P57', 'P50', 'P170', 'P178', 'P86', 'P175', 'P162', 'P58', 'P123', 'P272', 'P449', 'P264', 'P137', 'P126', 'P127', 'P749', 'P577', 'P571', 'P580', 'P856', 'P179', 'P2047', 'P345', 'P356', 'P212', 'P957']);
const trimClaim = claim => ({ rank: claim.rank, mainsnak: { snaktype: claim.mainsnak?.snaktype, datavalue: claim.mainsnak?.datavalue }, ...(claim.qualifiers?.P1545 ? { qualifiers: { P1545: claim.qualifiers.P1545.map(q => ({ datavalue: q.datavalue })) } } : {}) });
function trim(url, data) {
  if (!data) return data;
  if (url.includes('wbsearchentities')) return { search: (data.search || []).map(hit => ({ id: hit.id, label: hit.label, description: hit.description, match: hit.match && { type: hit.match.type, text: hit.match.text } })) };
  if (url.includes('wbgetentities')) return { entities: Object.fromEntries(Object.entries(data.entities || {}).map(([id, entity]) => [id, { id: entity.id, labels: entity.labels, descriptions: entity.descriptions, ...(entity.claims ? { claims: Object.fromEntries(Object.entries(entity.claims).filter(([p]) => KEEP.has(p)).map(([p, list]) => [p, list.map(trimClaim)])) } : {}) }])) };
  return data;
}
const recorded = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJSON(source, url) {
  await pause(400);
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (response.status === 404) { recorded[url] = null; return null; }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  const data = trim(url, await response.json());
  recorded[url] = data;
  return data;
}
const results = [];
for (const entry of SURVEY) {
  const outcome = await runLookup(entry.query, fetchJSON, { pause });
  const picked = outcome.suggestion?.url.match(/Q\d+$/)?.[0];
  const offered = (outcome.choices || []).map(choice => choice.url.match(/Q\d+$/)?.[0]);
  results.push({ name: entry.name, status: outcome.status, picked, offered, expected: entry.expected });
  console.log(entry.name.padEnd(34), outcome.status.padEnd(10), picked || offered.join(',') || '-', '| expected', entry.expected || 'none in Wikidata');
}
await writeFile(new URL('../tests/fixtures/wikidata-survey.json', import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), replies: recorded }));
