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
const textFields = ['title', 'container-title', 'publisher', 'publisher-place', 'volume', 'issue', 'page', 'edition', 'language', 'note', 'ISBN', 'ISSN', 'DOI', 'URL', 'OCLC', 'call-number', 'number-of-pages', 'keyword', 'abstract', 'collection-title', 'collection-number', 'archive', 'archive_location', 'event-title'];

export function validateItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !types.has(value.type) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const item = { type: value.type, title: value.title.trim() };
  for (const key of textFields) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' && !(typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
    item[key] = String(value[key]);
  }
  for (const role of ['author', 'editor', 'translator']) {
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
  if (value.issued !== undefined) {
    const parts = value.issued?.['date-parts'];
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2 || parts.some(p => !Array.isArray(p) || p.length < 1 || p.length > 3 || p.some(n => !Number.isInteger(n)) || (p[1] !== undefined && (p[1] < 1 || p[1] > 12)) || (p[2] !== undefined && (p[2] < 1 || p[2] > 31)))) return null;
    item.issued = { 'date-parts': parts };
  }
  return item;
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

export function toRIS(items) {
  const typeMap = { book: 'BOOK', chapter: 'CHAP', 'article-journal': 'JOUR', 'article-magazine': 'MGZN', 'article-newspaper': 'NEWS', thesis: 'THES', report: 'RPRT', manuscript: 'MANU', 'paper-conference': 'CPAPER', webpage: 'ELEC' };
  const tags = { title: 'TI', 'container-title': 'T2', publisher: 'PB', 'publisher-place': 'CY', volume: 'VL', issue: 'IS', page: 'SP', edition: 'ET', language: 'LA', note: 'N1', ISBN: 'SN', ISSN: 'SN', DOI: 'DO', URL: 'UR', abstract: 'AB', keyword: 'KW', 'call-number': 'CN' };
  const line = (tag, value) => `${tag}  - ${String(value).replace(/[\r\n]+/g, ' ')}\n`;
  return items.map(item => {
    let result = line('TY', typeMap[item.type] || 'GEN');
    for (const [role, tag] of [['author', 'AU'], ['editor', 'ED']]) {
      for (const person of item[role] || []) result += line(tag, person.literal || [person.family, person.given].filter(Boolean).join(', '));
    }
    for (const [field, tag] of Object.entries(tags)) if (item[field]) result += line(tag, item[field]);
    const year = item.issued?.['date-parts']?.[0]?.[0];
    if (year) result += line('PY', year);
    if (item.OCLC) result += line('N1', `OCLC: ${item.OCLC}`);
    return result + line('ER', '');
  }).join('\n');
}
