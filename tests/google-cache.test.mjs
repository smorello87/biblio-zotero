import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
import { createHandler } from '../server/worker.js';

const issuer = await createTestIdentityIssuer();
const KEY = 'AIzaSyTEST_key-0123456789abcdefghijk';
const env = { CAIL_IDENTITY_JWKS: issuer.jwksJson, CAIL_IDENTITY_ISSUER: issuer.issuer };
async function request(body, subject = TEST_SUBJECTS.alice) {
  return new Request('https://tools.ailab.gc.cuny.edu/bibliography/api/enrich', { method: 'POST', body: JSON.stringify(body), headers: {
    'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography', subject }),
    'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject }),
    origin: 'https://tools.ailab.gc.cuny.edu', 'content-type': 'application/json' } });
}
const book = { type: 'book', title: 'Book', author: 'Smith', year: 2000 };
const volume = { items: [{ id: 'abcd1234', volumeInfo: { title: 'Book', authors: ['Jo Smith'], publishedDate: '2000', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780306406157' }] } }] };
function upstream({ google = () => Response.json(volume), openLibrary = () => Response.json({ docs: [] }), crossref = () => Response.json({ message: { items: [] } }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    calls.push({ host: target.hostname, url: target.href, key: new Headers(init.headers).get('x-goog-api-key') });
    if (target.hostname === 'www.googleapis.com') return google(target, init);
    if (target.hostname === 'openlibrary.org') return openLibrary(target, init);
    if (target.hostname === 'api.crossref.org') return crossref(target, init);
    throw new Error(`unexpected host ${target.hostname}`);
  };
  return { calls, fetchImpl };
}
const run = async (handle, body, extraEnv = {}, subject) => {
  const response = await handle(await request(body, subject), { ...env, ...extraEnv });
  return { status: response.status, headers: response.headers, text: await response.text() };
};

test('the Google Books key goes only to www.googleapis.com, only as X-Goog-Api-Key, and never back out', async () => {
  const { calls, fetchImpl } = upstream();
  const reply = await run(createHandler({ fetchImpl }), book, { GOOGLE_BOOKS_API_KEY: `  ${KEY}\n` });
  assert.equal(reply.status, 200);
  assert.equal(JSON.parse(reply.text).status, 'matched');
  for (const call of calls) {
    assert.equal(call.key, call.host === 'www.googleapis.com' ? KEY : null, call.host);
    assert.ok(!call.url.includes(KEY) && !call.url.includes('key='), 'never in a URL');
  }
  assert.ok(!reply.text.includes(KEY) && ![...reply.headers.values()].some(value => value.includes(KEY)));
  // A redirect from Google to another allowlisted host does not carry the key along.
  const hop = upstream({ google: target => target.pathname.startsWith('/books') ? new Response(null, { status: 302, headers: { location: 'https://openlibrary.org/search.json?q=x' } }) : Response.json({}) });
  await run(createHandler({ fetchImpl: hop.fetchImpl }), book, { GOOGLE_BOOKS_API_KEY: KEY });
  assert.deepEqual(hop.calls.filter(call => call.key).map(call => call.host), ['www.googleapis.com']);
  assert.ok(hop.calls.some(call => call.url === 'https://openlibrary.org/search.json?q=x' && call.key === null));
});

test('without a key, Google Books is called keyless and a 429 keeps its plain rate-limit message', async () => {
  const { calls, fetchImpl } = upstream({ google: () => Response.json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }) });
  const reply = JSON.parse((await run(createHandler({ fetchImpl }), book)).text);
  assert.ok(calls.filter(call => call.host === 'www.googleapis.com').every(call => call.key === null));
  assert.match(reply.message, /Google Books refused the request \(rate limit\)/);
});

test('with a key, Google quota refusals say the Lab\'s quota is used up; other refusals do not; error text is never passed on', async () => {
  const secret = 'internal detail that must not leak';
  const cases = [
    [() => Response.json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: secret } }, { status: 429 }), "Google Books refused the request (the Lab's Google Books quota is used up for today)"],
    [() => Response.json({ error: { code: 403, message: secret, errors: [{ reason: 'dailyLimitExceeded' }] } }, { status: 403 }), "Google Books refused the request (the Lab's Google Books quota is used up for today)"],
    [() => Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', message: secret, details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 }), 'Google Books refused the request (HTTP 403)'],
    [() => new Response(secret, { status: 503 }), 'Google Books had a server error (503)'],
  ];
  for (const [google, wording] of cases) {
    const { fetchImpl } = upstream({ google });
    const text = (await run(createHandler({ fetchImpl }), book, { GOOGLE_BOOKS_API_KEY: KEY })).text;
    assert.ok(JSON.parse(text).message.includes(wording), wording);
    assert.ok(!text.includes(secret) && !text.includes(KEY));
  }
});

test('a malformed key is reported as a configuration problem and Google is not called', async () => {
  const { calls, fetchImpl } = upstream();
  const reply = JSON.parse((await run(createHandler({ fetchImpl }), book, { GOOGLE_BOOKS_API_KEY: 'not a key' })).text);
  assert.equal(calls.filter(call => call.host === 'www.googleapis.com').length, 0);
  assert.match(reply.message, /Google Books is not configured correctly \(the Lab's API key is malformed\)/);
  assert.ok(!JSON.stringify(reply).includes('not a key'));
});

test('catalog replies are cached for everyone: a day for records, ten minutes for nothing found', async () => {
  let clock = 1_000_000;
  const { calls, fetchImpl } = upstream();
  const seen = [];
  const handle = createHandler({ fetchImpl, cacheOptions: { now: () => clock, edge: () => undefined }, onCatalogCache: counts => seen.push(`memory=${counts.memory}, edge=${counts.edge}, miss=${counts.miss}`) });
  const first = await run(handle, book, { GOOGLE_BOOKS_API_KEY: KEY });
  assert.equal(seen.at(-1), 'memory=0, edge=0, miss=3');
  // The cache is shared, so its state is never in a response (it would reveal others' lookups).
  assert.deepEqual([...first.headers.keys()].filter(name => /cache/i.test(name) && name !== 'cache-control'), []);
  const upstreamCalls = calls.length;
  // Another person, same entry: served from cache, no upstream request, same answer.
  const second = await run(handle, book, { GOOGLE_BOOKS_API_KEY: KEY }, TEST_SUBJECTS.bob);
  assert.equal(seen.at(-1), 'memory=3, edge=0, miss=0');
  assert.equal(second.text, first.text, 'a cached reply is byte-identical');
  assert.equal(calls.length, upstreamCalls);
  assert.equal(JSON.parse(second.text).suggestion.url, JSON.parse(first.text).suggestion.url);
  // After 11 minutes the empty Open Library and Crossref replies expire; the Google record does not.
  clock += 11 * 60 * 1000;
  await run(handle, book, { GOOGLE_BOOKS_API_KEY: KEY });
  assert.equal(seen.at(-1), 'memory=1, edge=0, miss=2');
  clock += 24 * 60 * 60 * 1000;
  await run(handle, book, { GOOGLE_BOOKS_API_KEY: KEY });
  assert.equal(seen.at(-1), 'memory=0, edge=0, miss=3');
});

test('refusals, server errors and timeouts are never cached', async () => {
  for (const google of [() => new Response('busy', { status: 429 }), () => new Response('down', { status: 503 }), (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))]) {
    const { calls, fetchImpl } = upstream({ google });
    const handle = createHandler({ fetchImpl, cacheOptions: { edge: () => undefined } });
    const timer = setInterval(() => {}, 1000);
    try {
      await run(handle, book);
      await run(handle, book);
    } finally { clearInterval(timer); }
    assert.equal(calls.filter(call => call.host === 'www.googleapis.com').length, 2, 'Google asked again');
  }
});

test('the shared cache holds only public catalog data under a hashed key: no person, no key', async () => {
  const puts = [];
  const edge = { match: async () => undefined, put: async (key, response) => { puts.push({ url: key.url, body: await response.text(), control: response.headers.get('cache-control') }); } };
  const { fetchImpl } = upstream();
  await run(createHandler({ fetchImpl, cacheOptions: { edge: () => edge } }), book, { GOOGLE_BOOKS_API_KEY: KEY });
  assert.equal(puts.length, 3);
  for (const put of puts) {
    assert.match(put.url, /^https:\/\/tools\.ailab\.gc\.cuny\.edu\/bibliography\/__catalog-cache\/[0-9a-f]{64}$/);
    for (const forbidden of [KEY, TEST_SUBJECTS.alice, 'Smith', 'Book']) assert.ok(!put.url.includes(forbidden));
    assert.ok(!put.body.includes(KEY) && !put.body.includes(TEST_SUBJECTS.alice));
  }
  assert.deepEqual(puts.map(put => put.control).sort(), ['public, max-age=600', 'public, max-age=600', 'public, max-age=86400']);
});
