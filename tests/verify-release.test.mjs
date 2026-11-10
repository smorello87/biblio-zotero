import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = 'a'.repeat(40);
const good = () => ({
  deployments: [{ id: 'deployment-1', versions: [{ version_id: 'version-1', percentage: 100 }] }],
  subdomain: { enabled: false, previews_enabled: false },
  version: {
    id: 'version-1',
    annotations: { 'workers/tag': sha, 'workers/message': `commit ${sha}` },
    resources: {
      bindings: [
        { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
        { name: 'CAIL_IDENTITY_JWKS', type: 'secret_text' },
        { name: 'CAIL_IDENTITY_ISSUER', type: 'plain_text', text: 'https://tools.ailab.gc.cuny.edu/cail-sso' },
        { name: 'SCRAPE_HOSTS', type: 'plain_text', text: 'italianamericanimprints.omeka.net' },
        { name: 'CATALOG_HOSTS', type: 'plain_text', text: 'openlibrary.org,api.crossref.org,www.googleapis.com,www.wikidata.org' },
        { name: 'ASSETS', type: 'assets' },
        { name: 'GATEWAY', type: 'service', service: 'cail-model-api' },
      ],
      script_runtime: { compatibility_date: '2026-09-07', compatibility_flags: ['enable_request_signal'] },
    },
  },
});
async function verify(fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-verify-'));
  try {
    const path = join(directory, 'fixture.json');
    await writeFile(path, JSON.stringify(fixture));
    return spawnSync(process.execPath, ['--import', './tests/fixtures/cloudflare-api-stub.mjs', 'scripts/verify-release.mjs'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'stub-token', RELEASE_SHA: sha, CLOUDFLARE_STUB_FIXTURE: path },
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('release readback passes for the pinned configuration', async () => {
  const result = await verify(good());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /control-plane readback passed/);
});
test('release readback fails when the Gateway binding, the request-signal flag, the date or the import allowlist drifts', async () => {
  const cases = [
    [fixture => { fixture.version.resources.bindings = fixture.version.resources.bindings.filter(binding => binding.name !== 'GATEWAY'); }, /GATEWAY service binding/],
    [fixture => { fixture.version.resources.bindings.find(binding => binding.name === 'GATEWAY').service = 'cail-gateway'; }, /GATEWAY service binding/],
    [fixture => { fixture.version.resources.bindings.find(binding => binding.name === 'CATALOG_HOSTS').text += ',evil.example'; }, /Catalog allowlist/],
    [fixture => { fixture.version.resources.bindings = fixture.version.resources.bindings.filter(binding => binding.name !== 'CATALOG_HOSTS'); }, /Catalog allowlist/],
    [fixture => { fixture.version.resources.script_runtime.compatibility_flags = []; }, /compatibility flags/],
    [fixture => { delete fixture.version.resources.script_runtime.compatibility_flags; }, /compatibility flags/],
    [fixture => { fixture.version.resources.script_runtime.compatibility_flags.push('nodejs_compat'); }, /compatibility flags/],
    [fixture => { fixture.version.resources.script_runtime.compatibility_date = '2026-11-17'; }, /compatibility date/],
    [fixture => { fixture.version.resources.bindings.find(binding => binding.name === 'SCRAPE_HOSTS').text = 'italianamericanimprints.omeka.net,example.com'; }, /allowlist/],
  ];
  for (const [mutate, message] of cases) {
    const fixture = good();
    mutate(fixture);
    const result = await verify(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});
test('wrangler.toml, the Worker and the release check agree on the catalog allowlist', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile('wrangler.toml', 'utf8');
  const worker = await readFile('server/worker.js', 'utf8');
  const verifier = await readFile('scripts/verify-release.mjs', 'utf8');
  const configured = toml.match(/^CATALOG_HOSTS = "([^"]+)"$/m)[1];
  assert.deepEqual(configured.split(','), JSON.parse(worker.match(/const CATALOG_HOSTS = (\[[^\]]+\]);/)[1].replaceAll("'", '"')));
  assert.ok(verifier.includes(`binding.text === '${configured}'`));
});
