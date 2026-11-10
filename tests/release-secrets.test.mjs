import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestIdentityIssuer } from '@cuny-ai-lab/cail-identity/testing';

// Runs the release job's secrets-file step exactly as written in the workflow.
const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
const program = workflow.match(/node --input-type=module -e '([^']+)'/)[1];
const { jwksJson } = await createTestIdentityIssuer();
async function secretsFile(extra) {
  const directory = await mkdtemp(join(tmpdir(), 'bibliography-release-'));
  const file = join(directory, 'secrets.json');
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { PATH: process.env.PATH, CAIL_IDENTITY_JWKS: jwksJson, RELEASE_SECRETS_FILE: file, ...extra } });
    if (result.status !== 0) return { error: result.stderr };
    return { secrets: JSON.parse(await readFile(file, 'utf8')), mode: (await stat(file)).mode & 0o777 };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('the release writes GOOGLE_BOOKS_API_KEY only when the environment secret exists, never empty', async () => {
  const KEY = 'AIzaSyTEST_key-0123456789abcdefghijk';
  for (const extra of [{}, { GOOGLE_BOOKS_API_KEY: '' }, { GOOGLE_BOOKS_API_KEY: '  \n' }]) {
    const { secrets, mode } = await secretsFile(extra);
    assert.deepEqual(Object.keys(secrets), ['CAIL_IDENTITY_JWKS']);
    assert.equal(mode, 0o600);
  }
  assert.deepEqual(Object.keys((await secretsFile({ GOOGLE_BOOKS_API_KEY: `${KEY}\n` })).secrets), ['CAIL_IDENTITY_JWKS', 'GOOGLE_BOOKS_API_KEY']);
  assert.equal((await secretsFile({ GOOGLE_BOOKS_API_KEY: KEY })).secrets.GOOGLE_BOOKS_API_KEY, KEY);
  const malformed = await secretsFile({ GOOGLE_BOOKS_API_KEY: 'not a key' });
  assert.match(malformed.error, /GOOGLE_BOOKS_API_KEY is malformed/);
  assert.ok(!malformed.error.includes('not a key'), 'the value is never printed');
  assert.match(workflow, /GOOGLE_BOOKS_API_KEY: \$\{\{ secrets\.GOOGLE_BOOKS_API_KEY \}\}/);
});
