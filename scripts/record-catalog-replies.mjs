// Records live Open Library, Crossref and Google Books replies for the queries below once, for the
// offline lookup tests (tests/fixtures/catalog-replies.json). Network; not part of npm test.
import { writeFile } from 'node:fs/promises';
import { runLookup } from '../server/lookup.js';

const USER_AGENT = 'CUNY-AI-Lab-Bibliography/1.0 (https://tools.ailab.gc.cuny.edu/bibliography/; mailto:ailab@gc.cuny.edu)';
export const QUERIES = [
  { type: 'book', title: 'The Souls of Black Folk', author: 'Du Bois', year: 1903 },
  { type: 'book', title: 'A Room of One’s Own', author: 'Woolf', year: 1929 },
  { type: 'article-journal', title: 'What Is Digital Humanities and What’s It Doing in English Departments?', author: 'Kirschenbaum', year: 2010 },
  { type: 'article-journal', title: 'Attention Is All You Need', author: 'Vaswani', year: 2017, doi: '10.48550/arXiv.1706.03762' },
];
const recorded = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJSON(source, url) {
  await pause(1100);
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (response.status === 404) { recorded[url] = null; return null; }
  if (!response.ok) { recorded[url] = { status: response.status }; throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status }); }
  return (recorded[url] = await response.json());
}
for (const query of QUERIES) {
  const outcome = await runLookup(query, fetchJSON, { pause });
  console.log(query.title.slice(0, 40).padEnd(42), outcome.status, outcome.suggestion?.source || '', outcome.suggestion?.url || (outcome.choices || []).map(c => c.url).join(', '), JSON.stringify(outcome.sources));
}
await writeFile(new URL('../tests/fixtures/catalog-replies.json', import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), replies: recorded }));
