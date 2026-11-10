import test from 'node:test';
import assert from 'node:assert/strict';
import { parsingPrompt } from '../server/prompts.js';
import { reconcileItems, parseModelJSON, toRIS } from '../core.js';

// What the prompt asks for, so a reword cannot silently drop media or digital-project guidance.
test('the parsing prompt asks for media types, creator roles, series and episode, host institution, access date and date ranges', () => {
  for (const phrase of ['motion_picture', 'broadcast', 'song', 'webpage', 'dataset', 'software', 'director', 'producer', 'performer', 'host', 'container-title the series', 'number the episode number', 'publisher the network', 'publisher the host institution', 'accessed', '[[2014], [2020]]']) assert.ok(parsingPrompt.includes(phrase), phrase);
});

// Representative model replies for six citations (no model is called). Each reply is what a model
// following the prompt returns; the validator must keep every role, field and date it uses.
const citations = [
  ['dante', 'Alighieri, Dante. 2014–2020. The Divine Comedy. Digital Dante. Columbia University Libraries. https://digitaldante.columbia.edu/dante/divine-comedy/'],
  ['film', 'Darabont, Frank, dir. 1994. The Shawshank Redemption. Castle Rock Entertainment. 142 min.'],
  ['tv', '"The Gang Gets Invincible." 2006. It\'s Always Sunny in Philadelphia, season 2, episode 3. Directed by Matt Shakman. FX.'],
  ['podcast', 'Glass, Ira, host. 2014. "Serial, Episode 1: The Alibi." Serial. Podcast. Accessed November 9, 2026. https://serialpodcast.org/season-one/1/the-alibi'],
  ['dataset', 'Eltis, David, et al. 2019. Voyages: The Trans-Atlantic Slave Trade Database. Version 2.0. Emory University. https://www.slavevoyages.org'],
  ['software', 'Corporation for Digital Scholarship. 2024. Zotero. Version 7.0. https://www.zotero.org'],
];
const reply = { items: [
  { source_id: 'dante', type: 'webpage', title: 'The Divine Comedy', author: [{ family: 'Alighieri', given: 'Dante' }], 'container-title': 'Digital Dante', publisher: 'Columbia University Libraries', URL: 'https://digitaldante.columbia.edu/dante/divine-comedy/', issued: { 'date-parts': [[2014], [2020]] } },
  { source_id: 'film', type: 'motion_picture', title: 'The Shawshank Redemption', director: [{ family: 'Darabont', given: 'Frank' }], publisher: 'Castle Rock Entertainment', dimensions: '142 min', issued: { 'date-parts': [[1994]] } },
  { source_id: 'tv', type: 'broadcast', title: 'The Gang Gets Invincible', 'container-title': "It's Always Sunny in Philadelphia", number: '3', director: [{ family: 'Shakman', given: 'Matt' }], publisher: 'FX', medium: 'Television', note: 'Season 2.', issued: { 'date-parts': [[2006]] } },
  { source_id: 'podcast', type: 'broadcast', title: 'Serial, Episode 1: The Alibi', 'container-title': 'Serial', host: [{ family: 'Glass', given: 'Ira' }], medium: 'Podcast', number: '1', URL: 'https://serialpodcast.org/season-one/1/the-alibi', accessed: { 'date-parts': [[2026, 11, 9]] }, issued: { 'date-parts': [[2014]] } },
  { source_id: 'dataset', type: 'dataset', title: 'Voyages: The Trans-Atlantic Slave Trade Database', author: [{ family: 'Eltis', given: 'David' }], version: '2.0', publisher: 'Emory University', URL: 'https://www.slavevoyages.org', note: 'et al.', issued: { 'date-parts': [[2019]] } },
  { source_id: 'software', type: 'software', title: 'Zotero', author: [{ literal: 'Corporation for Digital Scholarship' }], version: '7.0', URL: 'https://www.zotero.org', issued: { 'date-parts': [[2024]] } },
] };
test('media and digital-project records survive validation with their roles, series, episode, ranges and access dates', () => {
  const records = reconcileItems(parseModelJSON(JSON.stringify(reply)), citations.map(([id, source]) => ({ id, source })));
  assert.deepEqual(records.map(record => record.status), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready']);
  const [dante, film, tv, podcast, dataset, software] = records.map(record => record.item);
  assert.deepEqual(dante.issued, { 'date-parts': [[2014], [2020]] });
  assert.equal(dante['container-title'], 'Digital Dante');
  assert.equal(dante.publisher, 'Columbia University Libraries');
  assert.deepEqual(film.director, [{ family: 'Darabont', given: 'Frank' }]);
  assert.equal(film.dimensions, '142 min');
  assert.equal(tv.number, '3');
  assert.equal(tv['container-title'], "It's Always Sunny in Philadelphia");
  assert.deepEqual(podcast.host, [{ family: 'Glass', given: 'Ira' }]);
  assert.deepEqual(podcast.accessed, { 'date-parts': [[2026, 11, 9]] });
  assert.equal(dataset.version, '2.0');
  assert.deepEqual(software.author, [{ literal: 'Corporation for Digital Scholarship' }]);
  const ris = toRIS(records.map(record => record.item));
  assert.deepEqual([...ris.matchAll(/^TY  - (\w+)$/gm)].map(match => match[1]), ['ELEC', 'MPCT', 'MPCT', 'SOUND', 'DATA', 'COMP']);
});
test('a reply that puts a role or date in the wrong shape is rejected, not half-kept', () => {
  const entries = [{ id: 'film', source: citations[1][1] }];
  for (const item of [
    { source_id: 'film', type: 'motion_picture', title: 'T', director: 'Frank Darabont' },
    { source_id: 'film', type: 'motion_picture', title: 'T', issued: { 'date-parts': [['1994']] } },
    { source_id: 'film', type: 'motion_picture', title: 'T', issued: { 'date-parts': [[2014], [2016], [2020]] } },
    { source_id: 'film', type: 'film', title: 'T' },
  ]) assert.equal(reconcileItems({ items: [item] }, entries)[0].status, 'failed', JSON.stringify(item));
});
