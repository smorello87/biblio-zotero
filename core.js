// Pure bibliography transformations, shared by the browser and backend tests.
export function splitEntries(text) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const separator = /\n[\t ]*\n/.test(normalized) ? /\n[\t ]*\n(?:[\t ]*\n)*/ : /\n/;
  return normalized.split(separator).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function expandRepeatedAuthors(entries) {
  let previous = '';
  return entries.map(source => {
    const marker = /^(?:_{3,}|—+)\.?\s+/u;
    if (marker.test(source)) return previous ? source.replace(marker, `${previous}. `) : source;
    const match = source.match(/^(.+?)\.\s+(?=\[?\d{4}|n\.d\.)/u);
    previous = match ? match[1] : '';
    return source;
  });
}

const types = new Set(['article', 'article-journal', 'article-magazine', 'article-newspaper', 'bill', 'book', 'broadcast', 'chapter', 'classic', 'collection', 'dataset', 'document', 'entry', 'entry-dictionary', 'entry-encyclopedia', 'event', 'figure', 'graphic', 'hearing', 'interview', 'legal_case', 'legislation', 'manuscript', 'map', 'motion_picture', 'musical_score', 'pamphlet', 'paper-conference', 'patent', 'performance', 'periodical', 'personal_communication', 'post', 'post-weblog', 'regulation', 'report', 'review', 'review-book', 'software', 'song', 'speech', 'standard', 'thesis', 'treaty', 'webpage']);
// Text variables Zotero maps from CSL-JSON (zotero-schema csl.fields.text), plus OCLC, which the
// Open Library suggestion uses and RIS/CSL-JSON export carry as a note.
const textFields = ['title', 'title-short', 'container-title', 'collection-title', 'collection-number', 'publisher', 'publisher-place', 'original-publisher', 'original-publisher-place', 'event-title', 'event-place', 'authority', 'volume', 'number-of-volumes', 'issue', 'number', 'page', 'number-of-pages', 'section', 'edition', 'version', 'status', 'genre', 'medium', 'dimensions', 'scale', 'language', 'note', 'abstract', 'keyword', 'ISBN', 'ISSN', 'DOI', 'URL', 'PMID', 'PMCID', 'OCLC', 'call-number', 'archive', 'archive_location', 'source', 'license', 'references'];
// CSL name variables Zotero maps to a creator type (zotero-schema csl.names).
export const NAME_ROLES = ['author', 'container-author', 'chair', 'performer', 'composer', 'contributor', 'director', 'editor', 'executive-producer', 'guest', 'host', 'interviewer', 'narrator', 'original-author', 'organizer', 'producer', 'recipient', 'reviewed-author', 'series-creator', 'collection-editor', 'script-writer', 'translator'];
export const DATE_FIELDS = ['issued', 'accessed', 'original-date', 'submitted'];
const validDate = value => {
  const parts = value?.['date-parts'];
  return Array.isArray(parts) && parts.length >= 1 && parts.length <= 2 && !parts.some(p => !Array.isArray(p) || p.length < 1 || p.length > 3 || p.some(n => !Number.isInteger(n)) || (p[1] !== undefined && (p[1] < 1 || p[1] > 12)) || (p[2] !== undefined && (p[2] < 1 || p[2] > 31)));
};

export function validateItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !types.has(value.type) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const item = { type: value.type, title: value.title.trim() };
  for (const key of textFields) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' && !(typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
    item[key] = String(value[key]);
  }
  for (const role of NAME_ROLES) {
    if (value[role] === undefined) continue;
    if (!Array.isArray(value[role])) return null;
    item[role] = [];
    for (const person of value[role]) {
      if (!person || typeof person !== 'object' || Array.isArray(person)) return null;
      const name = {};
      for (const key of ['family', 'given', 'literal', 'suffix', 'non-dropping-particle', 'dropping-particle']) {
        if (person[key] !== undefined) {
          if (typeof person[key] !== 'string') return null;
          name[key] = person[key];
        }
      }
      if (!name.family?.trim() && !name.literal?.trim()) return null;
      item[role].push(name);
    }
  }
  // Two date-parts are a range, such as a project's "2014–2020".
  for (const key of DATE_FIELDS) {
    if (value[key] === undefined) continue;
    if (!validDate(value[key])) return null;
    item[key] = { 'date-parts': value[key]['date-parts'] };
  }
  return item;
}

// Models without structured-output support (Gemma 4 and Qwen 3 VL in the default menu) may ignore
// json_object mode and wrap the object in a Markdown fence or a sentence. Recover the outermost object;
// anything else is treated as no items, so every entry stays unresolved rather than misattributed.
export function parseModelJSON(content) {
  if (typeof content !== 'string') return {};
  const candidates = [content.trim()];
  const fenced = content.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = content.indexOf('{'), end = content.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));
  for (const candidate of candidates) {
    try { const value = JSON.parse(candidate); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* try the next candidate */ }
  }
  return {};
}

export function reconcileItems(response, entries) {
  const items = Array.isArray(response?.items) ? response.items : [];
  return entries.map(entry => {
    const matches = items.filter(item => item?.source_id === entry.id);
    const item = matches.length === 1 ? validateItem(matches[0]) : null;
    return item
      ? { ...entry, item: { ...item, id: entry.id }, status: 'ready', error: '' }
      : { ...entry, item: null, status: 'failed', error: matches.length > 1 ? 'The model returned this entry more than once.' : 'No valid record was returned for this entry.' };
  });
}

// RIS type for every CSL type the validator accepts. Each was checked against the RIS specification
// and against what Zotero's RIS translator imports it as (tests/fixtures/zotero-ris-map.json). Where
// Zotero has no matching RIS type it is the type Zotero's own RIS export uses (e.g. TV as MPCT).
export const RIS_TYPES = {
  article: 'GEN', 'article-journal': 'JOUR', 'article-magazine': 'MGZN', 'article-newspaper': 'NEWS', bill: 'BILL', book: 'BOOK',
  broadcast: 'MPCT', chapter: 'CHAP', classic: 'CLSWK', collection: 'EDBOOK', dataset: 'DATA', document: 'GEN', entry: 'GEN',
  'entry-dictionary': 'DICT', 'entry-encyclopedia': 'ENCYC', event: 'GEN', figure: 'FIGURE', graphic: 'ART', hearing: 'HEAR',
  interview: 'PCOMM', legal_case: 'CASE', legislation: 'STAT', manuscript: 'MANSCPT', map: 'MAP', motion_picture: 'MPCT',
  musical_score: 'MUSIC', pamphlet: 'PAMP', 'paper-conference': 'CONF', patent: 'PAT', performance: 'GEN', periodical: 'JFULL',
  personal_communication: 'PCOMM', post: 'ICOMM', 'post-weblog': 'BLOG', regulation: 'STAT', report: 'RPRT', review: 'JOUR',
  'review-book': 'JOUR', software: 'COMP', song: 'SOUND', speech: 'SLIDE', standard: 'STAND', thesis: 'THES', treaty: 'GEN', webpage: 'ELEC'
};
// A broadcast is TV unless its medium or genre says radio or podcast (Zotero exports those as SOUND).
const risType = item => item.type === 'broadcast' && /radio|podcast|audio/i.test(`${item.medium || ''} ${item.genre || ''}`) ? 'SOUND' : RIS_TYPES[item.type] || 'GEN';
const name = person => person.literal || [[person['non-dropping-particle'], person.family].filter(Boolean).join(' '), person.given, person.suffix].filter(Boolean).join(', ');
const risDate = parts => parts?.length ? `${parts[0]}/${parts[1] ? String(parts[1]).padStart(2, '0') : ''}/${parts[2] ? String(parts[2]).padStart(2, '0') : ''}/` : '';
// Creator tags by RIS type, as Zotero's RIS import reads them (A1/AU is the primary creator: director
// for MPCT, composer for SOUND, programmer for COMP, cartographer for MAP, and so on).
function creatorTags(ty) {
  const tags = [['author', 'AU'], ['editor', 'ED'], ['translator', 'A4']];
  if (ty === 'MPCT') return [['director', 'AU'], ...(tags.slice(1, 2)), ['producer', 'A3'], ['author', 'A4'], ['script-writer', 'A4'], ['translator', 'A4']];
  if (ty === 'SOUND' || ty === 'MUSIC') return [['composer', 'AU'], ['author', 'AU'], ['performer', 'A2'], ['host', 'A2'], ['guest', 'A2'], ['editor', 'ED'], ['translator', 'A4']];
  if (ty === 'PCOMM') return [['author', 'AU'], ['recipient', 'A2'], ['interviewer', 'A2'], ['translator', 'A4']];
  if (ty === 'CHAP') return [...tags, ['container-author', 'C2'], ['collection-editor', 'A3']];
  if (['CONF', 'DICT', 'ENCYC', 'MAP'].includes(ty)) return [...tags, ['collection-editor', 'A3']];
  if (ty === 'BOOK' || ty === 'RPRT') return [...tags, ['collection-editor', 'A2']];
  return tags;
}
// Field tags by RIS type. Most CSL fields have one tag; these differ by type in Zotero's RIS import.
function fieldTags(ty) {
  const container = ty === 'CONF' ? [['event-title', 'T2'], ['container-title', 'C3']] : ty === 'CASE' ? [['container-title', 'A2']] : ty === 'SLIDE' ? [['event-title', 'T2'], ['container-title', 'T2']] : [['container-title', 'T2']];
  const series = ['COMP', 'MAP', 'RPRT', 'BOOK'].includes(ty) ? 'T2' : 'T3';
  const number = { PAT: 'SN', RPRT: 'SN', STAND: 'SN', CASE: 'SV', DATA: 'NV' }[ty] || 'M1';
  const genre = ty === 'MPCT' ? 'C4' : ty === 'COMP' ? 'LA' : 'M3';
  const medium = ['MPCT', 'SOUND', 'MUSIC'].includes(ty) ? 'C5' : ty === 'COMP' ? 'M1' : 'M3';
  const pages = ['BOOK', 'THES', 'MANSCPT'].includes(ty) ? [['number-of-pages', 'SP'], ['page', 'SP']] : [['page', 'SP'], ['number-of-pages', 'SP']];
  const isbn = ['PAT', 'RPRT', 'STAND', 'JOUR', 'MGZN', 'NEWS', 'CASE'].includes(ty) ? [] : [['ISBN', 'SN']];
  const issn = ['JOUR', 'MGZN', 'NEWS'].includes(ty) ? [['ISSN', 'SN']] : [];
  return [
    ['title', 'TI'], ['title-short', 'ST'], ...container, ['collection-title', series], ['collection-number', ty === 'CHAP' ? 'SV' : 'M1'],
    ['publisher', 'PB'], ['authority', ty === 'PAT' ? 'A2' : ['BILL', 'HEAR'].includes(ty) ? 'T3' : 'PB'], ['publisher-place', 'CY'], ['event-place', ty === 'CONF' ? 'C1' : 'CY'],
    ['volume', 'VL'], ['issue', 'IS'], ['number', number], ...pages, ['section', ty === 'HEAR' ? 'T2' : 'SE'],
    ['edition', ['COMP', 'DATA'].includes(ty) ? 'N1' : 'ET'], ['version', 'ET'], ['genre', genre], ['medium', medium],
    ['dimensions', ty === 'MPCT' ? 'SP' : ty === 'ART' ? 'C3' : 'N1'], ['scale', 'C1'], ['status', ty === 'PAT' ? 'C6' : 'N1'],
    ['language', ty === 'COMP' ? 'N1' : 'LA'], ...isbn, ...issn, ['DOI', 'DO'], ['URL', 'UR'], ['abstract', 'AB'], ['keyword', 'KW'],
    ['call-number', 'CN'], ['archive', 'DB'], ['archive_location', 'AN'], ['note', 'N1']
  ];
}
const NOTE_LABELS = { edition: 'Edition', dimensions: 'Running time or size', status: 'Status', language: 'Language' };

export function toRIS(items) {
  const line = (tag, value) => `${tag}  - ${String(value).replace(/[\r\n]+/g, ' ')}\n`;
  return items.map(item => {
    const ty = risType(item);
    let result = line('TY', ty);
    const written = new Set();
    for (const [role, tag] of creatorTags(ty)) {
      if (written.has(role)) continue;
      // An author of a film is written as its primary creator only when it has no director.
      if (ty === 'MPCT' && role === 'author' && !item.director?.length) { for (const person of item.author || []) result += line('AU', name(person)); written.add(role); continue; }
      if ((ty === 'SOUND' || ty === 'MUSIC') && role === 'author' && item.composer?.length) continue;
      for (const person of item[role] || []) result += line(tag, name(person));
      written.add(role);
    }
    const used = new Set();
    for (const [field, tag] of fieldTags(ty)) {
      if (!item[field] || used.has(field)) continue;
      used.add(field);
      result += line(tag, tag === 'N1' && NOTE_LABELS[field] ? `${NOTE_LABELS[field]}: ${item[field]}` : item[field]);
    }
    const issued = item.issued?.['date-parts'];
    if (issued?.[0]?.[0]) { result += line('PY', issued[0][0]) + line('DA', risDate(issued[0])); if (issued[1]) result += line('N1', `Date: ${issued[0].join('-')}–${issued[1].join('-')}`); }
    if (item.accessed?.['date-parts']?.[0]?.[0]) result += line('Y2', risDate(item.accessed['date-parts'][0]));
    if (item.OCLC) result += line('N1', `OCLC: ${item.OCLC}`);
    return result + line('ER', '');
  }).join('\n');
}
