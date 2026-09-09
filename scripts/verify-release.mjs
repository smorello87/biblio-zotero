// Read-only control-plane verification. Private runtime and member acceptance
// remain separate: this script does not claim the service binding was exercised.
import assert from 'node:assert/strict';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, RELEASE_SHA: sha } = process.env;
assert(account && token && /^[0-9a-f]{40}$/.test(sha || ''), 'Release verification environment is incomplete');
const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/cail-bibliography`;
async function read(path) {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Cloudflare readback failed (${response.status})`);
  const body = await response.json();
  assert(body.success, 'Cloudflare readback was unsuccessful');
  return body.result;
}
const { deployments } = await read('/deployments');
const latest = deployments[0];
assert(latest?.versions.length === 1 && latest.versions[0].percentage === 100, 'Latest deployment must serve one version at 100%');
const version = await read(`/versions/${latest.versions[0].version_id}`);
const bindings = version.resources.bindings;
assert(version.id === latest.versions[0].version_id, 'Version readback differs from deployment');
assert(version.annotations?.['workers/tag'] === sha && version.annotations?.['workers/message'] === `commit ${sha}`, 'Deployed version metadata is not the requested commit');
assert(bindings.some(binding => binding.name === 'CF_VERSION_METADATA' && binding.type === 'version_metadata'), 'Platform version metadata binding is absent');
assert(bindings.some(binding => binding.name === 'CAIL_IDENTITY_JWKS' && binding.type === 'secret_text'), 'Pinned verifier secret is absent');
assert(bindings.some(binding => binding.name === 'CAIL_IDENTITY_ISSUER' && binding.text === 'https://tools.ailab.gc.cuny.edu/cail-sso'), 'Issuer differs from canonical issuer');
assert(bindings.some(binding => binding.name === 'ASSETS' && binding.type === 'assets'), 'Assets binding is absent');
assert(version.resources.script_runtime.compatibility_date === '2026-09-07', 'Unexpected runtime compatibility date');
const subdomain = await read('/subdomain');
assert(subdomain.enabled === false && subdomain.previews_enabled === false, 'Worker must have workers.dev and previews disabled');
// A second read detects another deployment during verification.
assert((await read('/deployments')).deployments[0].id === latest.id, 'Deployment changed during verification');
console.log(`Private Worker control-plane readback passed: commit ${sha}, version ${version.id}, 100% traffic. Runtime and member acceptance remain pending.`);
