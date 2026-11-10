import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';

// Runs the bundled Worker in real workerd with the production compatibility date and flags. All
// upstream traffic is answered by a stub replaying recorded catalog replies; nothing leaves the machine.
test('catalog lookups run under workerd: book sources in parallel, Wikidata for a film, polite User-Agent, no redirect off the allowlist', async () => {
  const flags = JSON.parse((await readFile('wrangler.toml', 'utf8')).match(/^compatibility_flags = (\[.*\])$/m)[1]);
  const vars = Object.fromEntries([...(await readFile('wrangler.toml', 'utf8')).matchAll(/^(CATALOG_HOSTS|SCRAPE_HOSTS) = "([^"]*)"$/gm)].map(([, key, value]) => [key, value]));
  const replies = { ...JSON.parse(await readFile('tests/fixtures/catalog-replies.json', 'utf8')).replies, ...JSON.parse(await readFile('tests/fixtures/wikidata-survey.json', 'utf8')).replies };
  const issuer = await createTestIdentityIssuer();
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-workerd-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.js'], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'] });
  const upstream = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    modules: true, scriptPath: outfile, modulesRoot: '/', compatibilityDate: '2026-09-07', compatibilityFlags: flags,
    bindings: { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson, ...vars },
    outboundService: async request => {
      upstream.push({ url: request.url, agent: request.headers.get('user-agent'), redirect: request.redirect });
      if (request.url.includes('title=Redirected')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
      const reply = replies[request.url];
      if (reply === undefined) return new Response('unexpected', { status: 500 });
      if (reply === null) return new Response('missing', { status: 404 });
      return typeof reply.status === 'number' ? new Response('refused', { status: reply.status }) : Response.json(reply);
    },
  }] }));
  const enrich = async body => {
    const response = await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/api/enrich', { method: 'POST', body: JSON.stringify(body), headers: {
      'content-type': 'application/json', origin: 'https://tools.ailab.gc.cuny.edu',
      'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }),
      'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }) } });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  };
  try {
    const book = await enrich({ type: 'book', title: 'The Souls of Black Folk', author: 'Du Bois', year: 1903 });
    assert.equal(book.status, 'matched');
    assert.equal(book.warning, 'Google Books refused the request (rate limit).');
    const film = await enrich({ type: 'motion_picture', title: 'The Shawshank Redemption', author: 'Darabont', year: 1994 });
    assert.equal(film.suggestion.url, 'https://www.wikidata.org/wiki/Q172241');
    const redirected = await enrich({ type: 'book', title: 'Redirected', author: 'Smith' });
    assert.match(redirected.message, /Open Library redirected to an address this tool does not use/);
    assert.ok(upstream.every(call => call.agent === 'CUNY-AI-Lab-Bibliography/1.0 (https://tools.ailab.gc.cuny.edu/bibliography/; mailto:ailab@gc.cuny.edu)'));
    assert.ok(upstream.every(call => ['openlibrary.org', 'api.crossref.org', 'www.googleapis.com', 'www.wikidata.org'].includes(new URL(call.url).hostname)), 'only catalog hosts');
    assert.ok(!upstream.some(call => call.url.startsWith('https://evil.example')), 'the redirect was not followed');
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});

const compatibilityFlags = JSON.parse((await readFile('wrangler.toml', 'utf8')).match(/^compatibility_flags = (\[.*\])$/m)[1]);
// The Gateway stand-in is a second workerd Worker (reached through the outbound service binding), so
// the abort is observed by the runtime's real subrequest cancellation, not by a Node-side callback.
const gatewayScript = `
let started = 0, aborted = 0;
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/__status') return Response.json({ started, aborted });
  if (url.pathname === '/v1/catalog') return Response.json({ object: 'list', data: [] });
  started++;
  await new Promise(resolve => { request.signal.addEventListener('abort', () => { aborted++; resolve(); }); setTimeout(resolve, 1500); });
  return new Response('late', { status: 503 });
} };`;
// What a global fetch() to the tool's own zone reaches in production: the zone origin, not the
// Gateway Worker. Any Gateway call that does not use the GATEWAY binding gets this 404.
const zoneOrigin = async () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
async function runWorker(flags) {
  const issuer = await createTestIdentityIssuer();
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-workerd-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.js'], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'] });
  const base = { modules: true, modulesRoot: '/', compatibilityDate: '2026-09-07', compatibilityFlags: flags };
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...base, compatibilityFlags: ['enable_request_signal'], name: 'caller', script: callerScript, serviceBindings: { APP: 'bibliography' } },
    { ...base, name: 'bibliography', scriptPath: outfile, bindings: { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson }, serviceBindings: { GATEWAY: 'gateway' }, outboundService: zoneOrigin },
    { ...base, name: 'gateway', compatibilityFlags: ['enable_request_signal'], script: gatewayScript },
  ] }));
  const headers = async () => ({
    'content-type': 'application/json', origin: 'https://tools.ailab.gc.cuny.edu',
    'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }),
    'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }),
  });
  return { runtime, headers, dispose: async () => { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
// Doorway reaches the tool through a service binding, so the caller Worker aborts its own subrequest
// while the Gateway call is in flight. (A raw HTTP disconnect on a buffered response is not detected by
// local workerd, so it cannot stand in for this path.)
const callerScript = `export default { async fetch(request, env) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  try { return await env.APP.fetch(request, { signal: controller.signal }); } catch (error) { return new Response(error.name, { status: 499 }); }
} };`;
async function gatewayAfterClientAbort(flags) {
  const worker = await runWorker(flags);
  try {
    const gateway = await worker.runtime.getWorker('gateway');
    const response = await worker.runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/api/parse', {
      method: 'POST', headers: await worker.headers(),
      body: JSON.stringify({ model: 'gpt-oss-120b', entries: [{ id: 'entry-1', source: 'Smith. 2020. A book.' }] }),
    });
    assert.equal(response.status, 499);
    await new Promise(resolve => setTimeout(resolve, 300));
    return await (await gateway.fetch('https://gateway/__status')).json();
  } finally { await worker.dispose(); }
}
test('wrangler.toml enables request.signal and an aborted caller aborts the Gateway fetch under workerd', async () => {
  assert.ok(compatibilityFlags.includes('enable_request_signal'));
  const status = await gatewayAfterClientAbort(compatibilityFlags);
  assert.deepEqual(status, { started: 1, aborted: 1 });
});
test('control: without enable_request_signal the same abort never reaches the Gateway fetch', async () => {
  // Shows the harness can tell the difference, so the test above is evidence for the flag.
  const status = await gatewayAfterClientAbort(compatibilityFlags.filter(flag => flag !== 'enable_request_signal'));
  assert.deepEqual(status, { started: 1, aborted: 0 });
});
test('the licence is served as text/plain from the built assets under workerd', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'ignore' });
  const issuer = await createTestIdentityIssuer();
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-workerd-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.js'], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'] });
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'bibliography', modules: true, modulesRoot: '/', compatibilityDate: '2026-09-07', compatibilityFlags, scriptPath: outfile,
    bindings: { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson },
    assets: { directory: 'dist', binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
  }] }));
  try {
    const headers = { 'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }), 'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }) };
    const response = await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/LICENSE.txt', { headers });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(await response.text(), /GNU GENERAL PUBLIC LICENSE/);
    const html = await (await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/', { headers })).text();
    assert.match(html, /href="LICENSE\.txt"/);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
test('quota and parse reach the Gateway Worker through the GATEWAY binding while the zone origin answers 404', async () => {
  const toml = await readFile('wrangler.toml', 'utf8');
  assert.match(toml, /\[\[services\]\]\s*binding = "GATEWAY"\s*service = "cail-model-api"/);
  const quota = await readFile('tests/fixtures/quota-2026-11-10.json', 'utf8');
  const gateway = `export default { async fetch(request) {
    const { pathname } = new URL(request.url);
    if (!request.headers.get('x-cail-identity-jwt') && pathname !== '/v1/catalog') return new Response('no credential', { status: 401 });
    if (pathname === '/v1/catalog') return Response.json({ object: 'list', data: [] });
    if (pathname === '/v1/quota') return new Response(${JSON.stringify(quota)}, { headers: { 'content-type': 'application/json' } });
    return Response.json({ choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }] });
  } };`;
  const issuer = await createTestIdentityIssuer();
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-workerd-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.js'], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'] });
  const base = { modules: true, modulesRoot: '/', compatibilityDate: '2026-09-07', compatibilityFlags };
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...base, name: 'bibliography', scriptPath: outfile, bindings: { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson }, serviceBindings: { GATEWAY: 'gateway' }, outboundService: zoneOrigin },
    { ...base, name: 'gateway', script: gateway },
  ] }));
  try {
    const headers = async () => ({ 'content-type': 'application/json', origin: 'https://tools.ailab.gc.cuny.edu', 'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }), 'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }) });
    const quotaResponse = await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/api/quota', { headers: await headers() });
    assert.equal(quotaResponse.status, 200, await quotaResponse.clone().text());
    assert.deepEqual(await quotaResponse.json(), JSON.parse(quota));
    const parse = await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/api/parse', { method: 'POST', headers: await headers(), body: JSON.stringify({ model: 'gpt-oss-120b', entries: [{ id: 'entry-1', source: 'Smith. 2020. A book.' }] }) });
    assert.equal(parse.status, 200, await parse.clone().text());
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
