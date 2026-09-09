import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEntries, reconcileItems, toRIS } from '../core.js';

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
