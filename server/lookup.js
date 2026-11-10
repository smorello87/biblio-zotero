// Catalog lookup: what to search for an entry, how to read each catalog's reply, and how to merge
// and choose among candidates. Pure (no fetch) so it can be tested without a network. The matching
// and merging rules are ported from the CUNY AI Lab Zotero plugin (CUNY-AI-Lab/zotero-autofill
// v1.1.2, src/modules/enrichment.ts) so both tools treat the same item the same way.
import { lookupPlan } from '../core.js';

export { lookupPlan };

// ==================== Normalising and matching (plugin parity) ====================

export function normalize(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** "Main title: subtitle" split on the first colon. */
function splitTitle(title) {
  const [main, ...rest] = String(title ?? '').split(/\s*:\s+/);
  return { main: normalize(main), sub: normalize(rest.join(' ')) };
}
/** Identical, or differing only by a subtitle one side lacks. Two different subtitles differ. */
export function titlesMatch(a, b) {
  if (normalize(a) && normalize(a) === normalize(b)) return true;
  const x = splitTitle(a), y = splitTitle(b);
  return Boolean(x.main) && x.main === y.main && (!x.sub || !y.sub);
}
/** Surname-based and case-insensitive: "Marazzi" matches "MARAZZI" and "Marazzi, Martino". */
export function authorMatches(candidateAuthor, author) {
  const wanted = normalize(author);
  if (!wanted) return true;
  const have = ` ${normalize(candidateAuthor)} `;
  if (have.includes(` ${wanted} `)) return true;
  const surname = wanted.split(' ').pop();
  return Boolean(surname) && have.includes(` ${surname} `);
}
function validISBN(value) {
  if (/^97[89]\d{10}$/.test(value)) return [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0;
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0;
  return false;
}
/** ISBN-13 for a valid ISBN-10 or -13, else "". */
export function canonicalISBN(value) {
  const normalized = String(value ?? '').replace(/[-\s]/g, '').toUpperCase();
  if (!validISBN(normalized)) return '';
  if (normalized.length === 13) return normalized;
  const stem = `978${normalized.slice(0, 9)}`;
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${stem}${(10 - (sum % 10)) % 10}`;
}
const DOI = /^10\.\d{4,9}\/\S{1,200}$/;
export function canonicalDOI(value) {
  const doi = String(value ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return DOI.test(doi) ? doi.toLowerCase() : '';
}
const year = value => String(value ?? '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1];
/** Normalised main title + first-creator surname: the identity of a work. */
function workKey(c) {
  const surname = normalize(c.author).split(' ').filter(part => part.length > 1 || /\d/.test(part)).pop();
  return `${splitTitle(c.title).main}|${surname || ''}`;
}

/**
 * Fold `incoming` into `merged`: same ISBN or DOI, or (when neither side has one) the same main title,
 * first-creator surname and year, is one record; fields missing from the earlier record are filled
 * from the later one, nothing present is overwritten. Different identifiers stay separate editions.
 */
export function mergeCandidates(merged, incoming) {
  const out = merged.map(c => ({ ...c, fields: { ...c.fields }, sources: [...c.sources] }));
  for (const c of incoming) {
    const isbn = canonicalISBN(c.isbn), doi = canonicalDOI(c.doi);
    const twin = out.find(m => {
      const mi = canonicalISBN(m.isbn), md = canonicalDOI(m.doi);
      if (isbn && mi) return isbn === mi;
      if (doi && md) return doi === md;
      return workKey(m) === workKey(c) && Boolean(m.year) && m.year === c.year && Boolean(splitTitle(c.title).main);
    });
    if (!twin) { out.push({ ...c, fields: { ...c.fields }, sources: [...c.sources] }); continue; }
    for (const [key, value] of Object.entries(c.fields)) if (twin.fields[key] === undefined) twin.fields[key] = value;
    for (const source of c.sources) if (!twin.sources.includes(source)) twin.sources.push(source);
    twin.isbn ||= c.isbn; twin.doi ||= c.doi; twin.year ||= c.year; twin.publisher ||= c.publisher; twin.author ||= c.author; twin.url ||= c.url;
  }
  return out;
}

const identity = (c, query) => titlesMatch(c.title, query.title) && authorMatches(c.author, query.author);
/**
 * The plugin's selection without its optional AI step: one candidate whose title, author and year
 * match is a match; several are offered as choices; none is "not found". Articles also accept a
 * title contained in the other and, for a single candidate, a different year (online-first dates).
 * A candidate whose ISBN differs from the entry's own ISBN is another edition and never offered.
 */
export function selectCandidates(candidates, query, { article = false } = {}) {
  const ownISBN = canonicalISBN(query.isbn);
  const pool = candidates.filter(c => !ownISBN || !canonicalISBN(c.isbn) || canonicalISBN(c.isbn) === ownISBN);
  const wanted = normalize(query.title);
  const identityMatches = pool.filter(c => (identity(c, query) || (article && authorMatches(c.author, query.author) && (normalize(c.title).includes(wanted) || (normalize(c.title) && wanted.includes(normalize(c.title)))))));
  const suitable = identityMatches.filter(c => !query.year || c.year === String(query.year));
  if (suitable.length === 1) return { match: suitable[0] };
  if (article && !suitable.length && identityMatches.length === 1) return { match: identityMatches[0] };
  if (suitable.length > 1) return { choices: suitable.slice(0, 5) };
  if (article && identityMatches.length > 1) return { choices: identityMatches.slice(0, 5) };
  return {};
}
export const hasIdentityMatch = (candidates, query) => candidates.some(c => identity(c, query) && (!query.year || c.year === String(query.year)));

// ==================== Failure wording (plugin parity) ====================

/** Why one catalog request failed. Never includes the URL. */
export class SourceError extends Error {
  constructor(kind, status) { super(kind); this.name = 'SourceError'; Object.assign(this, { kind, status }); }
}
export function describeSourceFailure(error) {
  const status = error?.status;
  if (error?.kind === 'quota') return 'refused the request (the Lab\'s Google Books quota is used up for today)';
  if (status === 429) return 'refused the request (rate limit)';
  if (status >= 500) return `had a server error (${status})`;
  if (status >= 400) return `refused the request (HTTP ${status})`;
  if (error?.kind === 'timeout' || error?.name === 'TimeoutError') return 'timed out';
  if (error?.kind === 'too_large') return 'sent more data than this tool accepts';
  if (error?.kind === 'unreadable') return 'sent an unreadable reply';
  if (error?.kind === 'redirect') return 'redirected to an address this tool does not use';
  if (error?.kind === 'disabled') return 'is not enabled';
  if (error?.kind === 'misconfigured') return 'is not configured correctly (the Lab\'s API key is malformed)';
  return 'could not be reached';
}
const list = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
const andList = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
/** "Google Books refused the request (rate limit). Open Library and Crossref found no match." */
export function describeSearchFailures(sources, { found = false } = {}) {
  const failed = new Map();
  for (const s of sources) if (s.error && !failed.has(s.name)) failed.set(s.name, s.error);
  if (!failed.size) return null;
  const empty = [...new Set(sources.filter(s => !failed.has(s.name)).map(s => s.name))];
  const text = [...failed].map(([name, error]) => `${name} ${error}`).join('; ');
  // Beside a suggestion, only the failures matter; "found no match" would be untrue.
  return empty.length && !found ? `${text}. ${andList(empty)} found no match.` : `${text}.`;
}
export const notFoundMessage = sources => `Not found in ${list([...new Set(sources.map(s => s.name))])}.`;
export const NO_CATALOG_MESSAGE = 'No catalog covers this kind of source; kept as written.';

// ==================== Reading catalog replies ====================
// Every value that can reach a record is a short string or integer; anything else is dropped.

const str = (value, max = 300) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
const firstStr = (value, max) => (Array.isArray(value) ? value : []).map(item => str(item, max)).find(Boolean);
const literal = value => { const name = str(value, 200); return name ? { literal: name } : undefined; };
const compact = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)));
const issued = y => y ? { 'date-parts': [[Number(y)]] } : undefined;
function candidate(source, url, { title, author, authors, yearValue, publisher, isbn, doi, fields }) {
  return { title, author, year: yearValue, publisher, isbn, doi, url, sources: [source], fields: compact(fields) };
}

/** Open Library search.json docs: each work contributes only its best-matching edition, so an ISBN, publisher and year always describe the same edition. */
export function parseOpenLibrary(data) {
  const docs = Array.isArray(data?.docs) ? data.docs.slice(0, 5) : [];
  return docs.flatMap(doc => {
    const edition = Array.isArray(doc?.editions?.docs) ? doc.editions.docs[0] || {} : {};
    const title = str(edition.title, 500) || str(doc?.title, 500);
    if (!title) return [];
    const isbns = (Array.isArray(edition.isbn) ? edition.isbn : []).filter(value => typeof value === 'string');
    const isbn = isbns.find(value => /^\d{13}$/.test(value) && canonicalISBN(value)) || isbns.find(value => /^\d{9}[\dX]$/.test(value) && canonicalISBN(value));
    const authors = (Array.isArray(doc.author_name) ? doc.author_name : []).map(literal).filter(Boolean).slice(0, 10);
    const y = year(firstStr(edition.publish_date));
    const publisher = firstStr(edition.publisher);
    const key = [edition.key, doc.key].find(value => typeof value === 'string' && /^\/(books\/OL\d+M|works\/OL\d+W)$/.test(value));
    return [candidate('Open Library', key ? `https://openlibrary.org${key}` : 'https://openlibrary.org', {
      title, author: authors[0]?.literal, yearValue: y, publisher, isbn,
      fields: { ISBN: isbn, publisher, 'publisher-place': firstStr(edition.publish_place), issued: issued(y), author: authors }
    })];
  });
}

const crossrefYear = work => {
  const parts = work?.['published-print']?.['date-parts']?.[0] || work?.['published-online']?.['date-parts']?.[0] || work?.issued?.['date-parts']?.[0] || work?.created?.['date-parts']?.[0];
  return Number.isInteger(parts?.[0]) ? String(parts[0]) : undefined;
};
export const CROSSREF_BOOK_TYPES = ['book', 'monograph', 'edited-book', 'reference-book'];
/** One Crossref work. Editors are never proposed as authors. */
export function parseCrossrefWork(work) {
  const doi = canonicalDOI(work?.DOI);
  const main = firstStr(work?.title, 500);
  if (!doi || !main) return null;
  const subtitle = firstStr(work?.subtitle, 300);
  const title = CROSSREF_BOOK_TYPES.includes(work?.type) && subtitle ? `${main}: ${subtitle}` : main;
  const authors = (Array.isArray(work?.author) ? work.author : []).map(person => {
    const name = compact({ family: str(person?.family, 200), given: str(person?.given, 200), literal: person?.family ? undefined : str(person?.name, 200) });
    return name.family || name.literal ? name : null;
  }).filter(Boolean).slice(0, 20);
  const isbns = (Array.isArray(work?.ISBN) ? work.ISBN : []).map(value => String(value).replace(/[^0-9Xx]/g, '').toUpperCase());
  const isbn = isbns.find(value => value.length === 13 && canonicalISBN(value)) || isbns.find(value => canonicalISBN(value));
  const y = crossrefYear(work);
  const publisher = str(work?.publisher);
  const first = authors[0];
  return candidate('Crossref', `https://doi.org/${doi}`, {
    title, author: first ? first.literal || [first.given, first.family].filter(Boolean).join(' ') : undefined, yearValue: y, publisher, isbn, doi,
    fields: { DOI: doi, ISBN: isbn, publisher, 'publisher-place': str(work?.['publisher-location']), 'container-title': firstStr(work?.['container-title'], 500), volume: str(work?.volume, 50), issue: str(work?.issue, 50), page: str(work?.page, 50), issued: issued(y), author: authors }
  });
}
export const parseCrossrefSearch = data => (Array.isArray(data?.message?.items) ? data.message.items.slice(0, 5) : []).map(parseCrossrefWork).filter(Boolean);

/** Google Books volumes (keyless; best effort). */
export function parseGoogleBooks(data) {
  return (Array.isArray(data?.items) ? data.items.slice(0, 5) : []).flatMap(item => {
    const info = item?.volumeInfo || {};
    const main = str(info.title, 500);
    if (!main) return [];
    const title = str(info.subtitle, 300) ? `${main}: ${info.subtitle.trim()}` : main;
    const ids = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const isbn = [ids.find(id => id?.type === 'ISBN_13'), ids.find(id => id?.type === 'ISBN_10')].map(id => str(id?.identifier, 20)).find(value => value && canonicalISBN(value));
    const authors = (Array.isArray(info.authors) ? info.authors : []).map(literal).filter(Boolean).slice(0, 10);
    const y = year(str(info.publishedDate, 20)?.slice(0, 4));
    const publisher = str(info.publisher);
    const id = typeof item?.id === 'string' && /^[\w-]{4,20}$/.test(item.id) ? item.id : null;
    return [candidate('Google Books', id ? `https://books.google.com/books?id=${id}` : 'https://books.google.com', {
      title, author: authors[0]?.literal, yearValue: y, publisher, isbn,
      fields: { ISBN: isbn, publisher, 'number-of-pages': Number.isSafeInteger(info.pageCount) && info.pageCount > 0 ? String(info.pageCount) : undefined, issued: issued(y), author: authors }
    })];
  });
}

// ==================== Wikidata (media and digital projects) ====================

// instance-of (P31) values accepted per lookup group, and the description wording Wikidata uses for
// them. A candidate must fit one or the other; a film never matches a novel of the same name.
const MEDIA_KINDS = {
  film: { classes: ['Q11424', 'Q24862', 'Q506240', 'Q93204', 'Q202866', 'Q226730', 'Q24869', 'Q20667187', 'Q17123180'], description: /\bfilm\b|\bmovie\b|\bdocumentary\b/i, not: /\b(score|soundtrack|album|song|novel|novella|book|character|poster|series)\b/i },
  broadcast: { classes: ['Q21191270', 'Q1983062', 'Q61855877', 'Q63952888'], description: /\bepisode\b|\bpodcast\b|\bradio (programme|program|broadcast)\b/i, not: /\b(album|song|novel|book|score)\b/i },
  music: { classes: ['Q7366', 'Q134556', 'Q482994', 'Q105543609', 'Q2188189', 'Q207628', 'Q208569'], description: /\bsong\b|\bsingle\b|\balbum\b|composition|\bmusic/i },
  software: { classes: ['Q7397', 'Q341', 'Q9135', 'Q166142', 'Q1639024', 'Q21127166', 'Q13199995', 'Q1330336', 'Q131093'], description: /software|application|\bprogram\b|library|\btool\b|reference management/i },
  dataset: { classes: ['Q1172284', 'Q8513', 'Q7094076', 'Q212805', 'Q35127'], description: /data ?set|database|\bdata\b|corpus/i },
  map: { classes: ['Q4006', 'Q133792', 'Q216526'], description: /\bmap\b|\batlas\b|cartograph/i },
  project: { classes: ['Q35127', 'Q212805', 'Q8513', 'Q7094076', 'Q1172284', 'Q166118', 'Q2668072', 'Q1123036', 'Q17152639', 'Q19967801', 'Q1260632', 'Q60474998'], description: /website|\bsite\b|digital|archive|database|library|project|online|edition|collection|portal|encyclop/i },
};
export const WIKIDATA_KIND = { motion_picture: 'film', broadcast: 'broadcast', song: 'music', musical_score: 'music', software: 'software', dataset: 'dataset', map: 'map', webpage: 'project', post: 'project', 'post-weblog': 'project' };

// Wikidata labels usually drop a leading article ("Walt Whitman Archive"); citations often keep it.
export const withoutArticle = title => String(title ?? '').replace(/^(the|a|an)\s+(?=\S)/i, '');
const sameName = (a, b) => titlesMatch(a, b) || titlesMatch(withoutArticle(a), withoutArticle(b));
/**
 * wbsearchentities hits whose label or matched alias is the searched title (subtitle- and
 * article-tolerant), those whose description fits the kind of source first.
 */
export function parseWikidataSearch(data, query, kind) {
  const fit = MEDIA_KINDS[kind];
  const hits = (Array.isArray(data?.search) ? data.search : []).filter(hit => typeof hit?.id === 'string' && /^Q\d{1,12}$/.test(hit.id)
    && [hit.label, hit.match?.text].some(text => typeof text === 'string' && sameName(text, query)));
  const fits = hit => Boolean(fit) && typeof hit.description === 'string' && fit.description.test(hit.description) && !fit.not?.test(hit.description);
  return [...hits.filter(fits), ...hits.filter(hit => !fits(hit))].map(hit => hit.id);
}
const claims = (entity, property) => (Array.isArray(entity?.claims?.[property]) ? entity.claims[property] : []).filter(claim => claim?.rank !== 'deprecated' && claim?.mainsnak?.snaktype === 'value');
const ids = (entity, property) => claims(entity, property).map(claim => claim.mainsnak.datavalue?.value?.id).filter(id => typeof id === 'string' && /^Q\d+$/.test(id));
const strings = (entity, property) => claims(entity, property).map(claim => claim.mainsnak.datavalue?.value).filter(value => typeof value === 'string' && value.length <= 300);
function times(entity, property) {
  return claims(entity, property).map(claim => {
    const value = claim.mainsnak.datavalue?.value;
    const match = typeof value?.time === 'string' && value.time.match(/^\+(\d{4})-(\d{2})-(\d{2})T/);
    if (!match) return null;
    const precision = Number(value.precision);
    return precision >= 11 ? [Number(match[1]), Number(match[2]), Number(match[3])] : precision === 10 ? [Number(match[1]), Number(match[2])] : precision === 9 ? [Number(match[1])] : null;
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);
}
const ROLE_PROPERTIES = [['director', 'P57'], ['author', 'P50'], ['author', 'P170'], ['author', 'P178'], ['composer', 'P86'], ['performer', 'P175'], ['producer', 'P162'], ['script-writer', 'P58']];
const PUBLISHER_PROPERTIES = ['P123', 'P272', 'P449', 'P264', 'P137', 'P126', 'P127', 'P749'];
/** Item IDs whose English labels are needed to describe these entities. */
export function referencedIds(entities) {
  const wanted = new Set();
  for (const entity of entities) for (const property of [...ROLE_PROPERTIES.map(([, p]) => p), ...PUBLISHER_PROPERTIES, 'P179', 'P31']) for (const id of ids(entity, property)) wanted.add(id);
  return [...wanted].slice(0, 50);
}
// Many items now carry their name only as a language-independent ("mul") label.
const label = entity => str(entity?.labels?.en?.value, 500) || str(entity?.labels?.mul?.value, 500);
export function labelsOf(data) {
  const out = new Map();
  for (const [id, entity] of Object.entries(data?.entities || {})) { const value = label(entity); if (/^Q\d+$/.test(id) && value) out.set(id, value); }
  return out;
}
const host = url => { try { const parsed = new URL(url); return parsed.protocol.startsWith('http') ? parsed.hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

/**
 * A Wikidata candidate from one entity, or null when its type does not fit. `via` says whether the
 * entry's title or its container (project or series name) matched the label: a container match
 * proposes only the project's publisher, name and website, never its dates or creators.
 */
export function wikidataCandidate(entity, names, kind, via) {
  const id = typeof entity?.id === 'string' && /^Q\d+$/.test(entity.id) ? entity.id : null;
  const titles = claims(entity, 'P1476').map(claim => claim.mainsnak.datavalue?.value).filter(value => typeof value?.text === 'string');
  const name = label(entity) || str((titles.find(value => value.language === 'en') || titles[0])?.text, 500);
  if (!id || !name) return null;
  const description = str(entity?.descriptions?.en?.value, 500) || '';
  const fit = MEDIA_KINDS[kind];
  const instance = ids(entity, 'P31');
  if (!instance.some(q => fit.classes.includes(q)) && !(fit.description.test(description) && !fit.not?.test(description))) return null;
  const roles = {};
  for (const [role, property] of ROLE_PROPERTIES) for (const ref of ids(entity, property)) { const person = names.get(ref); if (person) (roles[role] ||= []).some(p => p.literal === person) || roles[role].push({ literal: person }); }
  const publisher = PUBLISHER_PROPERTIES.flatMap(p => ids(entity, p)).map(ref => names.get(ref)).find(Boolean);
  const dates = [...times(entity, 'P577'), ...times(entity, 'P571'), ...times(entity, 'P580')].sort((a, b) => a[0] - b[0]);
  const website = strings(entity, 'P856').find(value => /^https?:\/\//.test(value));
  const series = claims(entity, 'P179')[0];
  const seriesName = series ? names.get(series.mainsnak.datavalue?.value?.id) : undefined;
  const episode = series?.qualifiers?.P1545?.[0]?.datavalue?.value;
  const duration = claims(entity, 'P2047')[0]?.mainsnak?.datavalue?.value;
  const minutes = duration?.unit === 'http://www.wikidata.org/entity/Q7727' ? Math.round(Number(duration.amount)) : NaN;
  const imdb = strings(entity, 'P345').find(value => /^(tt|nm)\d{5,10}$/.test(value));
  const doi = canonicalDOI(strings(entity, 'P356')[0]);
  const isbn = [...strings(entity, 'P212'), ...strings(entity, 'P957')].find(value => canonicalISBN(value));
  const creator = [...(roles.director || []), ...(roles.author || []), ...(roles.composer || []), ...(roles.performer || [])][0]?.literal;
  const fields = via === 'container'
    ? { 'container-title': name, publisher, URL: website }
    : { ...roles, publisher, issued: dates[0] ? { 'date-parts': [dates[0]] } : undefined, URL: website, 'container-title': seriesName, number: typeof episode === 'string' && /^\d{1,5}$/.test(episode) ? episode : undefined, dimensions: Number.isFinite(minutes) && minutes > 0 && minutes < 10000 ? `${minutes} min` : undefined, DOI: doi || undefined, ISBN: isbn, note: imdb ? `IMDb: ${imdb}` : undefined };
  return {
    ...candidate('Wikidata', `https://www.wikidata.org/wiki/${id}`, { title: name, author: creator, yearValue: dates[0] ? String(dates[0][0]) : undefined, publisher, isbn, doi, fields }),
    via, description, years: dates.map(d => d[0]), creators: Object.values(roles).flat().map(p => p.literal), series: seriesName, website,
  };
}

/**
 * Conservative. The label must match and the type fit. A year, creator or series the entry gives
 * must not contradict the item (when the item records one); a matching website is supporting
 * evidence only, since project sites move. One candidate confirmed by a year, creator, series or
 * website is a match; otherwise confirmed and unconfirmed candidates are offered as choices, never
 * picked automatically. A project matched through the entry's container name needs its website.
 */
export function selectWikidata(candidates, query) {
  const start = Number(query.year), end = Number(query.yearEnd) || start;
  const site = host(query.url);
  const checks = [
    query.year && { has: c => c.via === 'title' && c.years.length > 0, agrees: c => c.years.some(y => y >= start && y <= end), contradicts: true },
    query.author && { has: c => c.via === 'title' && c.creators.length > 0, agrees: c => c.creators.some(name => authorMatches(name, query.author)), contradicts: true },
    query.container && { has: c => c.via === 'title' && Boolean(c.series), agrees: c => titlesMatch(c.series, query.container), contradicts: true },
    site && { has: c => Boolean(c.website), agrees: c => host(c.website) === site, contradicts: false },
  ].filter(Boolean);
  const unique = [...new Map(candidates.map(c => [c.url, c])).values()];
  const judged = unique.map(c => ({
    c,
    contradicted: checks.some(k => k.contradicts && k.has(c) && !k.agrees(c)),
    agreed: checks.filter(k => k.has(c) && k.agrees(c)),
  })).filter(j => !j.contradicted);
  const websiteAgrees = j => Boolean(site) && Boolean(j.c.website) && host(j.c.website) === site;
  const confirmed = judged.filter(j => j.agreed.length && (j.c.via === 'title' || websiteAgrees(j)));
  if (confirmed.length === 1) return { match: { ...confirmed[0].c, confirmed: true } };
  const offered = [...confirmed.map(j => ({ ...j.c, confirmed: true })), ...judged.filter(j => !confirmed.includes(j)).map(j => ({ ...j.c, confirmed: false }))];
  return offered.length ? { choices: offered.slice(0, 5) } : {};
}

// ==================== One lookup ====================

const OL_FIELDS = 'key,title,author_name,editions,editions.key,editions.title,editions.isbn,editions.publish_date,editions.publisher,editions.publish_place';
const CROSSREF_SELECT = 'DOI,title,subtitle,author,publisher,publisher-location,container-title,volume,issue,page,published-print,published-online,issued,created,ISBN,type';
const GOOGLE_FIELDS = 'items(id,volumeInfo(title,subtitle,authors,publisher,publishedDate,industryIdentifiers,pageCount))';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
// Response-size bounds per request kind (bytes).
export const LIMITS = { search: 1024 * 1024, wikidataSearch: 256 * 1024, wikidataEntities: 4 * 1024 * 1024, wikidataLabels: 512 * 1024 };

export const urls = {
  openLibrary: query => `https://openlibrary.org/search.json?${new URLSearchParams({ title: query.title, ...(query.author ? { author: query.author } : {}), ...(query.year ? { q: `publish_year:${query.year}` } : {}), limit: '5', fields: OL_FIELDS })}`,
  openLibraryGeneral: query => `https://openlibrary.org/search.json?${new URLSearchParams({ q: [query.title, query.author].filter(Boolean).join(' '), limit: '5', fields: OL_FIELDS })}`,
  crossref: (query, types) => `https://api.crossref.org/works?${new URLSearchParams({ 'query.bibliographic': [query.title, query.author].filter(Boolean).join(' '), rows: '5', select: CROSSREF_SELECT, filter: types.map(type => `type:${type}`).join(',') })}`,
  crossrefWork: doi => `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
  googleBooks: query => `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q: [`intitle:${query.title}`, query.author ? `inauthor:${query.author}` : ''].filter(Boolean).join(' '), maxResults: '5', printType: 'books', fields: GOOGLE_FIELDS })}`,
  wikidataSearch: text => `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbsearchentities', format: 'json', language: 'en', uselang: 'en', type: 'item', limit: '10', search: text })}`,
  wikidataEntities: ids => `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.join('|'), props: 'claims|labels|descriptions', languages: 'en|mul' })}`,
  wikidataLabels: ids => `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.join('|'), props: 'labels', languages: 'en|mul' })}`,
};

async function runSource(name, search) {
  try { const candidates = await search(); return { report: { name, found: candidates.length }, candidates }; }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { report: { name, found: 0, error: describeSourceFailure(error) }, candidates: [] };
  }
}

async function searchWikidata(query, kind, fetchJSON) {
  const searches = [[query.title, 'title'], ...(withoutArticle(query.title) !== query.title ? [[withoutArticle(query.title), 'title']] : []), ...(query.container && kind === 'project' ? [[query.container, 'container']] : [])];
  const found = await Promise.all(searches.map(async ([text, via]) => parseWikidataSearch(await fetchJSON('Wikidata', urls.wikidataSearch(text), LIMITS.wikidataSearch), text, kind).map(id => [id, via])));
  const via = new Map();
  for (const [id, how] of found.flat()) if (!via.has(id)) via.set(id, how);
  const wanted = [...via.keys()].slice(0, 4);
  if (!wanted.length) return [];
  const entities = Object.values((await fetchJSON('Wikidata', urls.wikidataEntities(wanted), LIMITS.wikidataEntities))?.entities || {}).filter(entity => wanted.includes(entity?.id));
  const refs = referencedIds(entities);
  const names = refs.length ? labelsOf(await fetchJSON('Wikidata', urls.wikidataLabels(refs), LIMITS.wikidataLabels)) : new Map();
  return entities.map(entity => wikidataCandidate(entity, names, kind, via.get(entity.id))).filter(Boolean);
}

const suggestion = c => ({
  title: c.title, url: c.url, source: c.sources.join(' + '),
  summary: [c.author, c.year, c.publisher].filter(Boolean).join(' · '),
  ...(c.description ? { description: c.description } : {}),
  ...(c.confirmed === false ? { confirmed: false } : {}),
  fields: c.fields,
});

/**
 * Look one entry up in every catalog its type allows, in parallel. `fetchJSON(source, url, limit)`
 * returns parsed JSON, null for "no such record" (404), or throws a SourceError; one source failing
 * never stops the others, and a failure is reported as such, never as "not found".
 */
export async function runLookup(query, fetchJSON, { pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const doi = canonicalDOI(query.doi);
  const plan = lookupPlan(query.type, { doi: Boolean(doi) });
  if (plan.group === 'none') return { status: 'unsupported', message: NO_CATALOG_MESSAGE, sources: [] };
  const reports = [];
  const result = (outcome, candidates = []) => {
    const warning = describeSearchFailures(reports, { found: Boolean(outcome.match || outcome.choices) });
    if (outcome.match) return { status: 'matched', suggestion: suggestion(outcome.match), sources: reports, ...(warning ? { warning } : {}) };
    if (outcome.choices) return { status: 'choices', choices: outcome.choices.map(suggestion), sources: reports, ...(warning ? { warning } : {}) };
    if (warning) return { status: 'failed', message: `The lookup could not be completed. ${warning}`, sources: reports };
    return { status: 'not_found', message: notFoundMessage(reports.length ? reports : plan.sources.map(name => ({ name }))), sources: reports, considered: candidates.length };
  };
  if (doi) {
    const direct = await runSource('Crossref', async () => {
      const data = await fetchJSON('Crossref', urls.crossrefWork(doi), LIMITS.search);
      const work = data ? parseCrossrefWork(data.message) : null;
      return work ? [work] : [];
    });
    reports.push(direct.report);
    const work = direct.candidates[0];
    // A DOI the parser read from the citation must still describe that citation.
    if (work && (titlesMatch(work.title, query.title) || normalize(work.title).includes(normalize(query.title)) || normalize(query.title).includes(normalize(work.title)))) return result({ match: work });
    if (plan.group === 'doi') return result({});
  }
  if (plan.group === 'book') {
    const first = await Promise.all([
      runSource('Open Library', async () => parseOpenLibrary(await fetchJSON('Open Library', urls.openLibrary(query), LIMITS.search))),
      runSource('Crossref', async () => parseCrossrefSearch(await fetchJSON('Crossref', urls.crossref(query, CROSSREF_BOOK_TYPES), LIMITS.search))),
      runSource('Google Books', async () => parseGoogleBooks(await fetchJSON('Google Books', urls.googleBooks(query), LIMITS.search))),
    ]);
    let merged = [];
    for (const { report, candidates } of first) { reports.push(report); merged = mergeCandidates(merged, candidates); }
    if (!hasIdentityMatch(merged, query)) {
      // Open Library again: keep about a second between its requests, as the plugin does.
      await pause(1000);
      const general = await runSource('Open Library', async () => parseOpenLibrary(await fetchJSON('Open Library', urls.openLibraryGeneral(query), LIMITS.search)));
      reports.push(general.report);
      merged = mergeCandidates(merged, general.candidates);
    }
    return result(selectCandidates(merged, query), merged);
  }
  if (plan.group === 'article') {
    const crossref = await runSource('Crossref', async () => parseCrossrefSearch(await fetchJSON('Crossref', urls.crossref(query, plan.crossrefTypes), LIMITS.search)));
    reports.push(crossref.report);
    return result(selectCandidates(crossref.candidates, query, { article: true }), crossref.candidates);
  }
  const media = await runSource('Wikidata', () => searchWikidata(query, WIKIDATA_KIND[query.type], fetchJSON));
  reports.push(media.report);
  return result(selectWikidata(media.candidates, query), media.candidates);
}
