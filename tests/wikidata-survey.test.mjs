import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runLookup } from '../server/lookup.js';
import { SURVEY } from './fixtures/wikidata-survey-queries.mjs';

// Replays the live Wikidata replies recorded by scripts/record-wikidata-survey.mjs on 2026-11-10.
const { replies } = JSON.parse(await readFile(new URL('./fixtures/wikidata-survey.json', import.meta.url), 'utf8'));
const replay = async (source, url) => {
  assert.equal(source, 'Wikidata');
  assert.ok(Object.hasOwn(replies, url), `not recorded: ${url}`);
  return structuredClone(replies[url]);
};
const outcomes = await Promise.all(SURVEY.map(async entry => {
  const outcome = await runLookup(entry.query, replay, { pause: async () => {} });
  const id = suggestion => suggestion?.url.match(/Q\d+$/)?.[0];
  return { ...entry, status: outcome.status, picked: id(outcome.suggestion), offered: (outcome.choices || []).map(id) };
}));

test('the recorded survey: what Wikidata finds for twelve DH projects and twelve films and episodes', () => {
  const table = outcomes.map(o => [o.name, o.status, o.picked || o.offered.join(',') || '-', o.expected || 'not in Wikidata']);
  console.log(table.map(row => row.join(' | ')).join('\n'));
  // Never a wrong automatic pick.
  for (const o of outcomes) if (o.picked) assert.equal(o.picked, o.expected, o.name);
  // Nothing is offered or picked for an entry Wikidata has no item for.
  for (const o of outcomes.filter(o => !o.expected)) assert.equal(o.status, 'not_found', o.name);
  const count = (group, test) => outcomes.filter(o => o.group === group && test(o)).length;
  // Films and episodes: all twelve picked correctly.
  assert.equal(count('film', o => o.picked === o.expected) + count('tv', o => o.picked === o.expected), 12);
  // Projects: 7 picked; 2 offered as unconfirmed choices (Walt Whitman Archive, Rossetti Archive:
  // Wikidata records no date, creator or the cited website for them); 2 not in Wikidata at all
  // (Digital Dante, Old Bailey Online); TEI not offered, its item being an organisation and markup
  // language, not a website. The Divine Comedy itself (the poem) is never proposed for Digital Dante.
  assert.equal(count('project', o => o.picked === o.expected), 7);
  assert.equal(count('project', o => !o.picked && o.offered.includes(o.expected)), 2);
  assert.deepEqual(outcomes.filter(o => o.group === 'project' && o.expected && !o.picked && !o.offered.includes(o.expected)).map(o => o.name), ['Text Encoding Initiative']);
});
