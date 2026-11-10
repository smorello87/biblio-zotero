import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEntries, reconcileItems, toRIS, parseModelJSON, lookupQuery, applySuggestion, catalogLink } from '../core.js';

test('preserves title-first citations and wrapped lines', () => {
  assert.deepEqual(splitEntries('Home and Belonging. 2020.\n\nSmith, Jo. 2021.\nA long title.'), ['Home and Belonging. 2020.', 'Smith, Jo. 2021. A long title.']);
});
test('matches missing middle entries by identity, never by position', () => {
  const entries = ['A', 'B', 'C'].map(id => ({ id, source: `Citation ${id}` }));
  const records = reconcileItems({ items: [{ source_id: 'C', type: 'book', title: 'C' }, { source_id: 'A', type: 'book', title: 'A' }] }, entries);
  assert.deepEqual(records.map(r => r.status), ['ready', 'failed', 'ready']);
  assert.equal(records[1].source, 'Citation B');
  assert.equal(records[2].item.title, 'C');
});
test('rejects null, duplicate identities and malformed fields', () => {
  const entries = [{ id: 'A', source: 'Citation A' }];
  for (const items of [[null], [{ source_id: 'A', title: 'A', type: 'book', author: 'Wrong' }], [{ source_id: 'A', title: 'A', type: 'book' }, { source_id: 'A', title: 'A', type: 'book' }]]) {
    assert.equal(reconcileItems({ items }, entries)[0].status, 'failed');
  }
});
test('RIS preserves identifiers, institutional authors and protects record boundaries', () => {
  const ris = toRIS([{ type: 'book', title: 'A\nER  - injected', author: [{ literal: 'CUNY AI Lab' }], ISBN: '9781234567897', DOI: '10.1234/example', URL: 'https://example.org', abstract: 'Description' }]);
  assert.match(ris, /AU  - CUNY AI Lab/);
  assert.match(ris, /SN  - 9781234567897/);
  assert.match(ris, /DO  - 10.1234\/example/);
  assert.match(ris, /UR  - https:\/\/example.org/);
  assert.equal(ris.split('\n').filter(line => line.startsWith('ER  -')).length, 1);
});
test('model output in a Markdown fence or with surrounding prose still reconciles; junk yields no items', () => {
  const entries = [{ id: 'A', source: 'Citation A' }];
  const object = '{"items":[{"source_id":"A","type":"book","title":"A"}]}';
  for (const content of [object, '```json\n' + object + '\n```', 'Here is the result:\n```\n' + object + '\n```\nDone.', 'Sure. ' + object]) {
    assert.equal(reconcileItems(parseModelJSON(content), entries)[0].status, 'ready', content);
  }
  for (const content of [undefined, '', 'no json here', '```json\n{"items": [\n```', 'null']) assert.deepEqual(parseModelJSON(content), {});
  // A bare array is not the requested object; whatever is recovered from it carries no items.
  assert.equal(reconcileItems(parseModelJSON('[{"source_id":"A","type":"book","title":"A"}]'), entries)[0].status, 'failed');
});
test('a lookup sends only identifying fields; a suggestion fills only what is missing and must leave a valid record', () => {
  const dante = { id: 'r1', type: 'webpage', title: 'The Divine Comedy', author: [{ family: 'Alighieri', given: 'Dante' }], 'container-title': 'Digital Dante', publisher: 'Columbia University Libraries', URL: 'https://digitaldante.columbia.edu/dante/divine-comedy/', issued: { 'date-parts': [[2014], [2020]] }, note: 'Accessed in 2026.' };
  assert.deepEqual(lookupQuery(dante), { type: 'webpage', title: 'The Divine Comedy', author: 'Alighieri', year: 2014, yearEnd: 2020, container: 'Digital Dante', url: 'https://digitaldante.columbia.edu/dante/divine-comedy/' });
  assert.equal(lookupQuery({ type: 'motion_picture', title: 'Film', director: [{ literal: 'Agnès Varda' }] }).author, 'Agnès Varda');
  const filled = applySuggestion(dante, { publisher: 'Someone Else', DOI: '10.1/x', director: [{ literal: 'X' }] });
  assert.equal(filled.publisher, 'Columbia University Libraries');
  assert.equal(filled.DOI, '10.1/x');
  assert.equal(filled.id, 'r1');
  // The record's own date is kept, so a malformed suggested date is never reached here...
  assert.deepEqual(applySuggestion(dante, { issued: { 'date-parts': [['bad']] } }).issued, dante.issued);
  // ...but a malformed value that would be added leaves the record untouched.
  assert.equal(applySuggestion({ type: 'book', title: 'T' }, { issued: { 'date-parts': [['bad']] } }), null);
});
test('only HTTPS links to the known catalogs are shown', () => {
  for (const url of ['https://openlibrary.org/works/OL1W', 'https://doi.org/10.1/x', 'https://books.google.com/books?id=abc', 'https://www.wikidata.org/wiki/Q1']) assert.equal(catalogLink(url), url);
  for (const url of ['javascript:alert(1)', 'http://openlibrary.org/works/OL1W', 'https://evil.example/', 'https://user:pw@openlibrary.org/', 'not a url', undefined]) assert.equal(catalogLink(url), null);
});
