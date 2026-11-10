import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createHandler } from '../server/worker.js';
import { titlesMatch, authorMatches, mergeCandidates, selectCandidates, describeSearchFailures, canonicalISBN } from '../server/lookup.js';
import { lookupPlan } from '../core.js';

const issuer = await createTestIdentityIssuer();
const env = { CAIL_IDENTITY_JWKS: issuer.jwksJson, CAIL_IDENTITY_ISSUER: issuer.issuer };
async function request(body) {
  return new Request('https://tools.ailab.gc.cuny.edu/bibliography/api/enrich', { method: 'POST', body: JSON.stringify(body), headers: {
    'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }),
    'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }),
    origin: 'https://tools.ailab.gc.cuny.edu', 'content-type': 'application/json' } });
}
const recorded = JSON.parse(await readFile(new URL('./fixtures/catalog-replies.json', import.meta.url), 'utf8')).replies;
const survey = JSON.parse(await readFile(new URL('./fixtures/wikidata-survey.json', import.meta.url), 'utf8')).replies;
const replay = replies => async url => {
  const key = String(url);
  if (!Object.hasOwn(replies, key)) return new Response('unexpected', { status: 500 });
  const reply = replies[key];
  if (reply === null) return new Response('missing', { status: 404 });
  // The recorder stores a refused request as { status: <HTTP code> } (Crossref bodies carry status: 'ok').
  if (typeof reply.status === 'number') return new Response('refused', { status: reply.status });
  return Response.json(reply);
};
// Node's AbortSignal.timeout() timers do not keep the event loop alive; workerd's do.
const keepingAlive = async work => { const timer = setInterval(() => {}, 1000); try { return await work(); } finally { clearInterval(timer); } };
const lookup = async (body, fetchImpl, extraEnv = {}) => {
  const response = await keepingAlive(async () => createHandler({ fetchImpl })(await request(body), { ...env, ...extraEnv }));
  return { status: response.status, body: await response.json() };
};
const byHost = handlers => async (url, init) => {
  const target = new URL(String(url));
  const handler = handlers[target.hostname];
  assert.ok(handler, `fetched an unexpected host: ${target.hostname}`);
  return handler(target, init);
};
const empty = () => Response.json({});

test('plugin parity: subtitle-tolerant titles, surname authors, ISBN de-duplication', () => {
  assert.ok(titlesMatch('The Souls of Black Folk', 'The Souls of Black Folk: Essays and Sketches'));
  assert.ok(!titlesMatch('Orlando: A Biography', 'Orlando: Women’s Writing'));
  assert.ok(authorMatches('MARAZZI, Martino', 'Marazzi') && authorMatches('Martino Marazzi', 'martino marazzi') && !authorMatches('Rossi', 'Marazzi'));
  assert.equal(canonicalISBN('0-306-40615-2'), '9780306406157');
  const a = { title: 'Book', author: 'Smith', year: '2000', isbn: '0306406152', sources: ['Open Library'], fields: { publisher: 'P' } };
  const b = { title: 'Book: A Subtitle', author: 'J. Smith', year: '2001', isbn: '9780306406157', sources: ['Google Books'], fields: { publisher: 'Other', 'number-of-pages': '200' } };
  const merged = mergeCandidates([a], [b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].fields, { publisher: 'P', 'number-of-pages': '200' });
  assert.deepEqual(merged[0].sources, ['Open Library', 'Google Books']);
  // Two editions (different ISBNs) are offered as choices, never picked.
  const two = mergeCandidates([a], [{ ...a, isbn: '9781234567897', sources: ['Crossref'] }]);
  assert.equal(selectCandidates(two, { title: 'Book', author: 'Smith', year: 2000 }).choices.length, 2);
  // An entry's own ISBN rules out other editions.
  assert.equal(selectCandidates(two, { title: 'Book', author: 'Smith', year: 2000, isbn: '9781234567897' }).match.isbn, '9781234567897');
  assert.equal(describeSearchFailures([{ name: 'Google Books', error: 'refused the request (rate limit)' }, { name: 'Open Library' }, { name: 'Crossref' }]), 'Google Books refused the request (rate limit). Open Library and Crossref found no match.');
});

test('a book is searched in Open Library, Crossref and Google Books together; a rate-limited source is named, not hidden', async () => {
  const { status, body } = await lookup({ type: 'book', title: 'The Souls of Black Folk', author: 'Du Bois', year: 1903 }, replay(recorded));
  assert.equal(status, 200);
  assert.equal(body.status, 'matched');
  assert.equal(body.suggestion.source, 'Open Library');
  assert.match(body.suggestion.url, /^https:\/\/openlibrary\.org\/books\/OL\d+M$/);
  assert.deepEqual(body.sources.map(s => s.name), ['Open Library', 'Crossref', 'Google Books']);
  assert.equal(body.warning, 'Google Books refused the request (rate limit).');
});

test('an article is searched in Crossref by type; a DOI the catalog does not hold falls back to search', async () => {
  const kirschenbaum = await lookup({ type: 'article-journal', title: 'What Is Digital Humanities and What’s It Doing in English Departments?', author: 'Kirschenbaum', year: 2010 }, replay(recorded));
  assert.equal(kirschenbaum.body.status, 'matched');
  assert.equal(kirschenbaum.body.suggestion.fields.DOI, '10.1632/ade.150.55');
  assert.equal(kirschenbaum.body.suggestion.fields['container-title'], 'ADE Bulletin');
  const crossrefCalls = [];
  const arxiv = await lookup({ type: 'article-journal', title: 'Attention Is All You Need', author: 'Vaswani', year: 2017, doi: '10.48550/arXiv.1706.03762' }, async (url, init) => { crossrefCalls.push(String(url)); return replay(recorded)(url, init); });
  assert.equal(arxiv.body.status, 'not_found');
  assert.equal(arxiv.body.message, 'Not found in Crossref.');
  assert.match(crossrefCalls[0], /\/works\/10\.48550%2Farxiv\.1706\.03762$/);
  assert.match(crossrefCalls[1], /filter=type%3Ajournal-article%2Ctype%3Abook-chapter%2Ctype%3Aproceedings-article/);
});

test('a DOI is fetched directly and accepted only when it describes the cited title', async () => {
  const work = { DOI: '10.1234/abc', title: ['Real Title'], author: [{ family: 'Smith', given: 'J.' }], 'container-title': ['Journal'], issued: { 'date-parts': [[2020]] } };
  const calls = [];
  const fetchImpl = byHost({ 'api.crossref.org': url => { calls.push(url.pathname); return url.pathname.startsWith('/works/') ? Response.json({ message: work }) : Response.json({ message: { items: [] } }); } });
  const good = await lookup({ type: 'article-journal', title: 'Real Title', author: 'Smith', doi: 'https://doi.org/10.1234/ABC' }, fetchImpl);
  assert.equal(good.body.status, 'matched');
  assert.deepEqual(calls, ['/works/10.1234%2Fabc']);
  calls.length = 0;
  const wrong = await lookup({ type: 'article-journal', title: 'A Different Paper', author: 'Smith', doi: '10.1234/abc' }, fetchImpl);
  assert.equal(wrong.body.status, 'not_found');
  assert.deepEqual(calls, ['/works/10.1234%2Fabc', '/works']);
});

test('several plausible records are offered as choices', async () => {
  const doc = (key, isbn, year) => ({ key: '/works/OL1W', title: 'Book', author_name: ['Jo Smith'], editions: { docs: [{ key, title: 'Book', isbn: [isbn], publish_date: [year], publisher: ['P'] }] } });
  const { body } = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({
    'openlibrary.org': () => Response.json({ docs: [doc('/books/OL1M', '9780306406157', '2000'), doc('/books/OL2M', '9781234567897', '2010')] }),
    'api.crossref.org': () => Response.json({ message: { items: [] } }), 'www.googleapis.com': () => Response.json({}),
  }));
  assert.equal(body.status, 'choices');
  assert.deepEqual(body.choices.map(c => c.fields.ISBN), ['9780306406157', '9781234567897']);
});

test('when every source fails the entry is "could not be completed", never "not found"; one failure never stops the others', async () => {
  const { body } = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({
    'openlibrary.org': () => new Response('busy', { status: 503 }),
    'api.crossref.org': () => new Response('slow down', { status: 429 }),
    'www.googleapis.com': () => { throw new TypeError('network down'); },
  }));
  assert.equal(body.status, 'failed');
  assert.equal(body.message, 'The lookup could not be completed. Open Library had a server error (503); Crossref refused the request (rate limit); Google Books could not be reached.');
  const partial = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({ 'openlibrary.org': () => Response.json({ docs: [] }), 'api.crossref.org': () => new Response('slow down', { status: 429 }), 'www.googleapis.com': empty }));
  assert.equal(partial.body.status, 'failed');
  assert.equal(partial.body.message, 'The lookup could not be completed. Crossref refused the request (rate limit). Open Library and Google Books found no match.');
  const none = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({ 'openlibrary.org': () => Response.json({ docs: [] }), 'api.crossref.org': () => Response.json({ message: { items: [] } }), 'www.googleapis.com': empty }));
  assert.equal(none.body.status, 'not_found');
  assert.equal(none.body.message, 'Not found in Open Library, Crossref or Google Books.');
});

test('a source that hangs times out on its own deadline while the others answer', async () => {
  const doc = { key: '/works/OL1W', title: 'Book', author_name: ['Jo Smith'], editions: { docs: [{ key: '/books/OL1M', title: 'Book', isbn: ['9780306406157'], publish_date: ['2000'] }] } };
  const { body } = await lookup({ type: 'book', title: 'Book', author: 'Smith', year: 2000 }, byHost({
    'openlibrary.org': () => Response.json({ docs: [doc] }),
    'api.crossref.org': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    'www.googleapis.com': empty,
  }));
  assert.equal(body.status, 'matched');
  assert.equal(body.warning, 'Crossref timed out.');
});

test('catalog replies are bounded, JSON only, and redirects may not leave the allowlist', async () => {
  let cancelled = false;
  const { body } = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({
    'openlibrary.org': () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: 'https://evil.example/steal' } }),
    'api.crossref.org': () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    'www.googleapis.com': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
  }));
  assert.equal(cancelled, true);
  assert.equal(body.message, 'The lookup could not be completed. Open Library redirected to an address this tool does not use; Crossref sent more data than this tool accepts; Google Books sent an unreadable reply.');
  // A redirect inside the allowlist is followed and re-checked.
  const followed = [];
  const ok = await lookup({ type: 'article-journal', title: 'T', author: 'A' }, byHost({ 'api.crossref.org': url => { followed.push(url.pathname); return url.pathname === '/works' ? new Response(null, { status: 301, headers: { location: '/v1/works?x=1' } }) : Response.json({ message: { items: [] } }); } }));
  assert.equal(ok.body.status, 'not_found');
  assert.deepEqual(followed, ['/works', '/v1/works']);
});

test('only the fixed catalog hosts are ever fetched; the entry URL is compared, never requested; CATALOG_HOSTS can switch a source off', async () => {
  const hosts = [];
  const { body } = await lookup({ type: 'webpage', title: 'Internet Archive', url: 'https://archive.org/' }, async url => { hosts.push(new URL(String(url)).hostname); return replay(survey)(url); });
  assert.equal(body.status, 'matched');
  assert.deepEqual([...new Set(hosts)], ['www.wikidata.org']);
  const narrowed = await lookup({ type: 'book', title: 'Book', author: 'Smith' }, byHost({ 'openlibrary.org': () => Response.json({ docs: [] }), 'api.crossref.org': () => Response.json({ message: { items: [] } }) }), { CATALOG_HOSTS: 'openlibrary.org,api.crossref.org,evil.example' });
  assert.equal(narrowed.body.status, 'failed');
  assert.match(narrowed.body.message, /Google Books is not enabled/);
});

test('a film is described from Wikidata claims: director, company, date, website, running time, IMDb', async () => {
  const { body } = await lookup({ type: 'motion_picture', title: 'The Shawshank Redemption', author: 'Darabont', year: 1994 }, replay(survey));
  assert.equal(body.status, 'matched');
  const { fields, url } = body.suggestion;
  assert.equal(url, 'https://www.wikidata.org/wiki/Q172241');
  assert.deepEqual(fields.director, [{ literal: 'Frank Darabont' }]);
  assert.equal(fields.issued['date-parts'][0][0], 1994);
  assert.equal(fields.dimensions, '142 min');
  assert.match(fields.note, /^IMDb: tt0111161$/);
  assert.ok(fields.publisher);
  const episode = await lookup({ type: 'broadcast', title: 'Ozymandias', container: 'Breaking Bad', year: 2013 }, replay(survey));
  assert.equal(episode.body.suggestion.fields['container-title'], 'Breaking Bad');
  assert.deepEqual(episode.body.suggestion.fields.director, [{ literal: 'Rian Johnson' }]);
});

test('types no catalog covers are reported without any request; the owner\'s Digital Dante citation is "not found", not misattributed', async () => {
  for (const type of ['manuscript', 'personal_communication', 'legal_case', 'interview']) {
    const { body } = await lookup({ type, title: 'Letter' }, () => assert.fail('no request for a type no catalog covers'));
    assert.deepEqual(body, { status: 'unsupported', message: 'No catalog covers this kind of source; kept as written.', sources: [] });
  }
  assert.deepEqual(lookupPlan('manuscript', { doi: true }).sources, ['Crossref']);
  const dante = await lookup({ type: 'webpage', title: 'The Divine Comedy', container: 'Digital Dante', author: 'Alighieri', year: 2014, yearEnd: 2020, url: 'https://digitaldante.columbia.edu/dante/divine-comedy/' }, replay(survey));
  assert.equal(dante.body.status, 'not_found');
  assert.equal(dante.body.message, 'Not found in Wikidata.');
});

test('lookup requests are validated', async () => {
  for (const body of [{}, { type: 'book' }, { type: 'novel', title: 'T' }, { type: 'book', title: 'x'.repeat(501) }, { type: 'book', title: 'T', year: '1900' }, { type: 'book', title: 'T', url: 7 }]) {
    const { status, body: reply } = await lookup(body, () => assert.fail('no request'));
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(reply.error.code, 'invalid_request');
  }
});

test('a caller who cancels stops the lookup', async () => {
  const controller = new AbortController();
  const handle = createHandler({ fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) });
  const signed = await request({ type: 'article-journal', title: 'T', author: 'A' });
  const pending = handle(new Request(signed, { signal: controller.signal }), env);
  setTimeout(() => controller.abort(), 20);
  assert.equal((await keepingAlive(() => pending)).status, 499);
});
