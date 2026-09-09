import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';
const gatewayRoot = process.env.CAIL_GATEWAY_SOURCE;
assert(gatewayRoot, 'Set CAIL_GATEWAY_SOURCE to installed current Gateway source');
const temporary = await mkdtemp(join(tmpdir(), 'bibliography-gateway-'));
const issuer = await createTestIdentityIssuer();
const common = { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson, CAIL_LOG_ENV: 'test' };
const compile = async (entry, name, alias) => {
  const outfile = join(temporary, name + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'], alias });
  return outfile;
};
let runtime;
try {
  const app = await compile('server/worker.js', 'app');
  const gateway = await compile('integration/gateway-fixture.mjs', 'gateway', { 'gateway-source': resolve(gatewayRoot, 'src/index.ts'), 'gateway-test-helpers': resolve(gatewayRoot, 'test/helpers.ts') });
  const base = { modules: true, modulesRoot: '/', compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat', 'enable_request_signal'] };
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...base, name: 'caller', script: `export default { fetch(request, env) { const url = new URL(request.url); url.protocol = 'https:'; url.host = 'tools.ailab.gc.cuny.edu'; const headers = new Headers(request.headers); headers.set('origin', url.origin); return env.APP.fetch(new Request(url, { method: request.method, headers, body: request.body })); } };`, serviceBindings: { APP: 'bibliography' } },
    { ...base, name: 'bibliography', scriptPath: app, bindings: common, outboundService: 'gateway' },
    { ...base, name: 'gateway', scriptPath: gateway, bindings: { ...common, CAIL_GATEWAY_AUDIENCE: 'cail:gateway', MODEL_SOURCES: 'workers-ai,openrouter', AI_GATEWAY_ID: 'synthetic', CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef' } },
  ] }));
  await runtime.ready;
  const receiver = await runtime.getWorker('gateway');
  const bibliography = await runtime.getWorker('caller');
  const reset = async mode => receiver.fetch('https://fixture/fixture', { method: 'POST', body: JSON.stringify({ mode }) });
  const stats = async () => (await receiver.fetch('https://fixture/fixture')).json();
  const call = async ({ model = '@cf/openai/gpt-oss-120b', path = 'parse', other = false, missing = false } = {}) => bibliography.fetch(`https://tools.ailab.gc.cuny.edu/bibliography/api/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(!missing ? { 'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }), 'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: other ? TEST_SUBJECTS.bob : TEST_SUBJECTS.alice }) } : {}) },
    body: JSON.stringify(path === 'parse' ? { model, entries: [{ id: 'entry-1', source: 'Synthetic citation.' }] } : { model, image: 'data:image/png;base64,AAAA' }),
  });
  for (const model of ['@cf/openai/gpt-oss-120b', '@cf/google/gemma-4-26b-a4b-it', 'qwen/qwen3-vl-235b-a22b-instruct']) {
    await reset('success');
    const response = await call({ model });
    assert.equal(response.status, 200, await response.clone().text());
    const observed = await stats();
    assert.deepEqual(observed.apps, ['bibliography']);
    assert.deepEqual(observed.registry, [TEST_SUBJECTS.alice]);
    assert.equal(observed.upstream.length, 1);
    assert.equal(observed.upstream[0].body.model, model);
    assert.deepEqual(observed.upstream[0].body.response_format, { type: 'json_object' });
    assert.deepEqual(observed.upstream[0].metadata, { user_id: TEST_SUBJECTS.alice, budget_scope: 'person' });
    assert.equal(observed.upstream[0].attempts, '1');
    assert.equal(observed.upstream[0].cache, 'true');
    assert.equal(observed.upstream[0].payloadLog, 'false');
  }
  await reset('success');
  assert.equal((await call({ path: 'ocr', model: 'qwen/qwen3-vl-235b-a22b-instruct' })).status, 200);
  assert.equal((await stats()).upstream[0].body.messages[0].content[1].image_url.url, 'data:image/png;base64,AAAA');
  for (const invalid of [{ other: true }, { missing: true }]) {
    await reset('success');
    assert.equal((await call(invalid)).status, 401);
    assert.equal((await stats()).apps.length, 0);
  }
  for (const [mode, status] of [['registry-denied', 403], ['quota', 429], ['truncated', 502]]) {
    await reset(mode);
    const response = await call();
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await stats()).upstream.length, mode === 'registry-denied' ? 0 : 1);
    if (mode === 'quota') assert.equal(response.headers.get('x-should-retry'), 'false');
  }
  console.log('PASS: actual Workerd Bibliography → actual Gateway; three native model IDs, JSON object passthrough, Qwen image envelope, signed same-subject legs, attribution/accounting/privacy policy, one attempt, Registry refusal, spend refusal, truncated output. External Registry/discovery/provider are synthetic; no live inference or Admission verification.');
} finally { await runtime?.dispose(); await rm(temporary, { recursive: true, force: true }); }
