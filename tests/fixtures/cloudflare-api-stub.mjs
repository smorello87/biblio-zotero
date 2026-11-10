// Preloaded with --import: answers the Cloudflare API reads of scripts/verify-release.mjs from a
// JSON fixture so the verifier's assertions can be exercised without network or credentials.
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.env.CLOUDFLARE_STUB_FIXTURE, 'utf8'));
globalThis.fetch = async url => {
  const path = new URL(url).pathname.replace(/^.*\/workers\/scripts\/cail-bibliography/, '');
  const result = path === '/deployments' ? { deployments: fixture.deployments } : path === '/subdomain' ? fixture.subdomain : path.startsWith('/versions/') ? fixture.version : undefined;
  return result === undefined ? new Response('not found', { status: 404 }) : Response.json({ success: true, result });
};
