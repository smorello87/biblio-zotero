import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createTestIdentityIssuer, TEST_SUBJECTS } from '@cuny-ai-lab/cail-identity/testing';

// Runs the bundled Worker in real workerd with the production compatibility date and no flags.
// All upstream traffic is answered by a stub; nothing leaves the machine.
test('enrich returns 200 under workerd with a mocked Open Library', async () => {
  const issuer = await createTestIdentityIssuer();
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-workerd-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.js'], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:*'] });
  const upstream = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    modules: true, scriptPath: outfile, modulesRoot: '/', compatibilityDate: '2026-09-07',
    bindings: { CAIL_IDENTITY_ISSUER: issuer.issuer, CAIL_IDENTITY_JWKS: issuer.jwksJson },
    outboundService: async request => {
      upstream.push(request.url);
      return Response.json({ docs: [{ title: 'A Book', isbn: ['9780306406157'], key: '/works/OL1W', publisher: ['Press'] }] });
    },
  }] }));
  try {
    const response = await runtime.dispatchFetch('https://tools.ailab.gc.cuny.edu/bibliography/api/enrich', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: 'https://tools.ailab.gc.cuny.edu',
        'x-cail-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:bibliography' }),
        'x-cail-gateway-identity-jwt': await issuer.mintIdentityJwt({ audience: 'cail:gateway', subject: TEST_SUBJECTS.alice }),
      },
      body: JSON.stringify({ title: 'A Book', author: 'Smith' }),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const { suggestion } = JSON.parse(text);
    assert.equal(suggestion.fields.ISBN, '9780306406157');
    assert.equal(suggestion.url, 'https://openlibrary.org/works/OL1W');
    assert.match(upstream[0], /^https:\/\/openlibrary\.org\/search\.json\?/);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
