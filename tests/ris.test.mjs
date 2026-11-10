import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toRIS, validateItem, RIS_TYPES, NAME_ROLES } from '../core.js';

const ris = JSON.parse(await readFile(new URL('./fixtures/zotero-ris-map.json', import.meta.url), 'utf8'));
const csl = JSON.parse(await readFile(new URL('./fixtures/zotero-csl-map.json', import.meta.url), 'utf8'));
// Zotero's RIS import: the item type for a TY, and the field a tag lands in for that item type
// (same precedence as RIS.js's TagMapper: fieldMap, then degenerateImportFieldMap).
const importType = ty => ris.importTypeMap[ty] || ris.DEFAULT_IMPORT_TYPE;
function zoteroField(tag, itemType) {
  if (tag === 'N1') return 'notes';
  for (const map of [ris.fieldMap, ris.degenerateImportFieldMap]) {
    const entry = map[tag];
    if (entry === undefined) continue;
    if (typeof entry === 'string') return entry;
    for (const [field, typesFor] of Object.entries(entry)) if (!field.startsWith('__') && typesFor.includes(itemType)) return field;
    if (entry.__default && !(entry.__exclude || []).includes(itemType)) return entry.__default;
  }
  return undefined;
}
const imported = item => {
  const lines = toRIS([item]).trim().split('\n').map(line => line.match(/^([A-Z0-9]{2})  - (.*)$/)).filter(Boolean).map(([, tag, value]) => [tag, value]);
  const type = importType(lines[0][1]);
  return { ty: lines[0][1], type, fields: lines.slice(1).filter(([tag]) => !['ER', 'PY', 'DA', 'TY'].includes(tag)).map(([tag, value]) => [tag, zoteroField(tag, type), value]) };
};

// CSL type -> RIS TY -> Zotero item type on RIS import. Where Zotero itself has no lossless RIS type
// (its own export is degenerate too), the expected Zotero type differs from its CSL mapping.
const ROUND_TRIP = {
  article: ['GEN', 'journalArticle'], 'article-journal': ['JOUR', 'journalArticle'], 'article-magazine': ['MGZN', 'magazineArticle'], 'article-newspaper': ['NEWS', 'newspaperArticle'],
  bill: ['BILL', 'bill'], book: ['BOOK', 'book'], broadcast: ['MPCT', 'film'], chapter: ['CHAP', 'bookSection'], classic: ['CLSWK', 'book'], collection: ['EDBOOK', 'book'],
  dataset: ['DATA', 'dataset'], document: ['GEN', 'journalArticle'], entry: ['GEN', 'journalArticle'], 'entry-dictionary': ['DICT', 'dictionaryEntry'], 'entry-encyclopedia': ['ENCYC', 'encyclopediaArticle'],
  event: ['GEN', 'journalArticle'], figure: ['FIGURE', 'artwork'], graphic: ['ART', 'artwork'], hearing: ['HEAR', 'hearing'], interview: ['PCOMM', 'letter'], legal_case: ['CASE', 'case'],
  legislation: ['STAT', 'statute'], manuscript: ['MANSCPT', 'manuscript'], map: ['MAP', 'map'], motion_picture: ['MPCT', 'film'], musical_score: ['MUSIC', 'audioRecording'], pamphlet: ['PAMP', 'manuscript'],
  'paper-conference': ['CONF', 'conferencePaper'], patent: ['PAT', 'patent'], performance: ['GEN', 'journalArticle'], periodical: ['JFULL', 'journalArticle'], personal_communication: ['PCOMM', 'letter'],
  post: ['ICOMM', 'email'], 'post-weblog': ['BLOG', 'blogPost'], regulation: ['STAT', 'statute'], report: ['RPRT', 'report'], review: ['JOUR', 'journalArticle'], 'review-book': ['JOUR', 'journalArticle'],
  software: ['COMP', 'computerProgram'], song: ['SOUND', 'audioRecording'], speech: ['SLIDE', 'presentation'], standard: ['STAND', 'report'], thesis: ['THES', 'thesis'], treaty: ['GEN', 'journalArticle'], webpage: ['ELEC', 'webpage']
};
// Zotero's own RIS export is lossy for these too (RIS.js degenerateExportTypeMap or no RIS type at all).
const DEGENERATE = new Set(['article', 'broadcast', 'document', 'entry', 'event', 'interview', 'musical_score', 'performance', 'periodical', 'post', 'regulation', 'review', 'review-book', 'standard', 'treaty']);

test('every accepted CSL type has a RIS type that Zotero imports as the expected item type', () => {
  assert.deepEqual(Object.keys(RIS_TYPES).sort(), Object.keys(ROUND_TRIP).sort());
  for (const [cslType, [ty, zoteroType]] of Object.entries(ROUND_TRIP)) {
    const record = validateItem({ type: cslType, title: 'T' });
    assert.ok(record, cslType);
    const { ty: written, type } = imported(record);
    assert.equal(written, ty, cslType);
    assert.equal(type, zoteroType, `${cslType}: ${ty} imports as ${type}`);
    // Non-degenerate types land on a Zotero type Zotero's CSL mapping uses for that CSL type.
    // (classic, collection, figure and pamphlet have no Zotero CSL mapping at all.)
    if (!DEGENERATE.has(cslType) && csl.cslTypes[cslType]) assert.ok((csl.cslTypes[cslType] || []).includes(type), `${cslType} -> ${type} is not one of ${csl.cslTypes[cslType]}`);
  }
  // The old export wrote MANU and CPAPER/GEN defaults: MANU is not a RIS type and imported as a journal article.
  assert.equal(importType('MANU'), 'journalArticle');
});
test('a radio or podcast broadcast is exported as SOUND, as Zotero does', () => {
  assert.equal(imported(validateItem({ type: 'broadcast', title: 'Ep', medium: 'Podcast' })).ty, 'SOUND');
  assert.equal(imported(validateItem({ type: 'broadcast', title: 'Ep', genre: 'Radio broadcast' })).ty, 'SOUND');
});
const fieldsOf = item => Object.fromEntries(imported(validateItem(item)).fields.map(([tag, field, value]) => [`${tag}:${value}`, field]));
test('creator roles and type-specific fields land in the right Zotero fields', () => {
  const person = family => [{ family, given: 'A.' }];
  const cases = [
    [{ type: 'motion_picture', title: 'Film', director: person('Darabont'), producer: person('Marvin'), publisher: 'Columbia Pictures', dimensions: '142 min', genre: 'Drama', medium: 'DVD', issued: { 'date-parts': [[1994, 9, 23]] } },
      { 'AU:Darabont, A.': 'creators/director', 'A3:Marvin, A.': 'creators/producer', 'PB:Columbia Pictures': 'distributor', 'SP:142 min': 'runningTime', 'C4:Drama': 'genre', 'C5:DVD': 'videoRecordingFormat' }],
    [{ type: 'song', title: 'Song', composer: person('Gershwin'), performer: person('Fitzgerald'), publisher: 'Verve' },
      { 'AU:Gershwin, A.': 'creators/composer', 'A2:Fitzgerald, A.': 'creators/performer', 'PB:Verve': 'label' }],
    [{ type: 'software', title: 'Zotero', author: person('Stillman'), publisher: 'Corporation for Digital Scholarship', version: '7.0', genre: 'JavaScript', medium: 'macOS' },
      { 'AU:Stillman, A.': 'creators/programmer', 'PB:Corporation for Digital Scholarship': 'company', 'ET:7.0': 'versionNumber', 'LA:JavaScript': 'programmingLanguage', 'M1:macOS': 'system' }],
    [{ type: 'dataset', title: 'Voyages', author: person('Eltis'), publisher: 'Emory University', version: '2.0', number: 'TAST-2019' },
      { 'AU:Eltis, A.': 'creators/author', 'PB:Emory University': 'repository', 'ET:2.0': 'versionNumber', 'NV:TAST-2019': 'identifier' }],
    [{ type: 'map', title: 'Map', author: person('Blaeu'), scale: '1:50000', genre: 'Chart' },
      { 'AU:Blaeu, A.': 'creators/cartographer', 'C1:1:50000': 'scale', 'M3:Chart': 'mapType' }],
    [{ type: 'webpage', title: 'The Divine Comedy', author: person('Alighieri'), 'container-title': 'Digital Dante', publisher: 'Columbia University Libraries', URL: 'https://digitaldante.columbia.edu/dante/divine-comedy/', accessed: { 'date-parts': [[2026, 11, 9]] } },
      { 'AU:Alighieri, A.': 'creators/author', 'T2:Digital Dante': 'websiteTitle', 'PB:Columbia University Libraries': 'publisher', 'UR:https://digitaldante.columbia.edu/dante/divine-comedy/': 'url', 'Y2:2026/11/09/': 'accessDate' }],
    [{ type: 'post-weblog', title: 'Post', 'container-title': 'Blog', genre: 'Blog post' }, { 'T2:Blog': 'blogTitle', 'M3:Blog post': 'websiteType' }],
    [{ type: 'patent', title: 'Patent', author: person('Edison'), number: 'US223898', authority: 'USPTO', status: 'Expired' },
      { 'AU:Edison, A.': 'creators/inventor', 'SN:US223898': 'patentNumber', 'A2:USPTO': 'issuingAuthority', 'C6:Expired': 'legalStatus' }],
    [{ type: 'legal_case', title: 'Brown v. Board', authority: 'Supreme Court', 'container-title': 'U.S.', volume: '347', page: '483', number: '1' },
      { 'PB:Supreme Court': 'court', 'A2:U.S.': 'reporter', 'VL:347': 'reporterVolume', 'SP:483': 'firstPage', 'SV:1': 'docketNumber' }],
    [{ type: 'legislation', title: 'Act', 'container-title': 'U.S. Code', number: 'Pub. L. 1', section: '5' }, { 'T2:U.S. Code': 'code', 'M1:Pub. L. 1': 'publicLawNumber', 'SE:5': 'section' }],
    [{ type: 'report', title: 'Report', publisher: 'RAND', number: 'R-1', genre: 'Technical report', 'collection-title': 'Series' },
      { 'PB:RAND': 'institution', 'SN:R-1': 'reportNumber', 'M3:Technical report': 'reportType', 'T2:Series': 'seriesTitle' }],
    [{ type: 'thesis', title: 'Thesis', publisher: 'CUNY', genre: 'PhD dissertation', 'number-of-pages': '300' }, { 'PB:CUNY': 'university', 'M3:PhD dissertation': 'thesisType', 'SP:300': 'numPages' }],
    [{ type: 'paper-conference', title: 'Paper', 'container-title': 'Proceedings of DH', 'event-title': 'DH 2020', editor: person('Ed') },
      { 'T2:DH 2020': 'conferenceName', 'C3:Proceedings of DH': 'proceedingsTitle', 'ED:Ed, A.': 'creators/editor' }],
    [{ type: 'chapter', title: 'Chapter', 'container-title': 'Book', editor: person('Ed'), 'container-author': person('Main') },
      { 'T2:Book': 'bookTitle', 'ED:Ed, A.': 'creators/editor', 'C2:Main, A.': 'creators/bookAuthor' }],
    [{ type: 'book', title: 'Book', 'collection-title': 'Series', 'collection-number': '3', 'number-of-pages': '200', ISBN: '9780306406157' },
      { 'T2:Series': 'series', 'M1:3': 'seriesNumber', 'SP:200': 'numPages', 'SN:9780306406157': 'ISBN' }],
    [{ type: 'interview', title: 'Interview', author: person('Morrison'), interviewer: person('Rose') }, { 'AU:Morrison, A.': 'creators/author', 'A2:Rose, A.': 'creators/recipient' }],
    [{ type: 'graphic', title: 'Art', author: person('Kahlo'), medium: 'Oil on canvas', dimensions: '40 x 30 cm' }, { 'AU:Kahlo, A.': 'creators/artist', 'M3:Oil on canvas': 'artworkMedium', 'C3:40 x 30 cm': 'artworkSize' }],
  ];
  for (const [item, expected] of cases) {
    const actual = fieldsOf(item);
    for (const [key, field] of Object.entries(expected)) assert.equal(actual[key], field, `${item.type} ${key}`);
    for (const [key, field] of Object.entries(actual)) assert.ok(field, `${item.type} ${key} would be dropped on import`);
  }
});
test('a TV episode keeps its director, producer and network; its series and episode number travel as Zotero itself sends them', () => {
  const episode = validateItem({ type: 'broadcast', title: 'The Gang Gets Invincible', director: [{ family: 'Kelly', given: 'Matt' }], producer: [{ family: 'Day', given: 'Charlie' }], 'container-title': "It's Always Sunny in Philadelphia", publisher: 'FX', number: '3', issued: { 'date-parts': [[2006, 9, 14]] } });
  const fields = fieldsOf(episode);
  assert.equal(fields['AU:Kelly, Matt'], 'creators/director');
  assert.equal(fields['A3:Day, Charlie'], 'creators/producer');
  assert.equal(fields['PB:FX'], 'distributor');
  assert.match(toRIS([episode]), /T2  - It's Always Sunny in Philadelphia\n/);
  assert.match(toRIS([episode]), /DA  - 2006\/09\/14\/\n/);
});
test('a date range keeps its start in PY/DA and the whole range in a note', () => {
  const out = toRIS([validateItem({ type: 'webpage', title: 'Digital Dante', issued: { 'date-parts': [[2014], [2020]] } })]);
  assert.match(out, /PY  - 2014\n/);
  assert.match(out, /DA  - 2014\/\/\/\n/);
  assert.match(out, /N1  - Date: 2014–2020\n/);
});
test('CSL-JSON export keeps types and every Zotero-mapped creator role', () => {
  const zoteroRoles = new Set(Object.values(csl.cslNames));
  for (const role of NAME_ROLES) assert.ok(zoteroRoles.has(role), `${role} is not a role Zotero imports`);
  const item = { type: 'motion_picture', title: 'Film' };
  for (const role of NAME_ROLES) item[role] = [{ family: role, given: 'X' }];
  const kept = validateItem(item);
  for (const role of NAME_ROLES) assert.deepEqual(kept[role], [{ family: role, given: 'X' }], role);
  assert.equal(JSON.parse(JSON.stringify([kept]))[0].type, 'motion_picture');
  assert.deepEqual(validateItem({ type: 'webpage', title: 'T', accessed: { 'date-parts': [[2026, 11, 9]] } }).accessed, { 'date-parts': [[2026, 11, 9]] });
  assert.equal(validateItem({ type: 'webpage', title: 'T', accessed: { 'date-parts': [[2026, 13]] } }), null);
});
