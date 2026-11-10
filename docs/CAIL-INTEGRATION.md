# CAIL bibliography integration

The web tool is moving from browser-held OpenRouter keys to CAIL Doorway and
Gateway.

## Implementation and acceptance plan

- [ ] Build a CAIL tool interface using the OCR tool's DM Sans/Fraunces type,
  CUNY blues, neutral background, shared logo, and accessible controls.
- [ ] Add source review before conversion and preserve source IDs through results.
- [ ] Support direct PNG/JPG upload through the Gateway vision path, with image
  downscaling and a bounded request body.
- [ ] Verify the product assertion and the same-subject Gateway leg with the
  official CAIL Identity package. Forward only the Gateway leg via CAIL Client.
- [ ] Route parsing, OCR, catalog, and estimated quota through this backend.
  Cloudflare owns enforcement; there is no local spending ledger or app-key fallback.
- [ ] Test signed identities, identity mismatch, CSRF, quota display, single-attempt
  transport, parsing failures, export, and the browser workflow.
- [ ] Build and document the configuration and actual deployment work still needed.

## Reference and ownership

Source of the shared contract: CAIL knowledge base, Tool Integration Contract,
CAIL Doorway, Model Access and Provider Policy, and the official cail-identity
and cail-client documentation. The app owns bibliography parsing and results;
Doorway owns CUNY login/current Admission membership; Gateway owns model routing
and trusted personal accounting metadata; Cloudflare owns monetary enforcement.

Product audience proposed for this integration: `cail:bibliography`.
The Doorway owner must register the matching protected route and Gateway leg
before enabling production access. No production route or service change is
implied by this repository's local build.

The curated model choices are prefix-free Gateway IDs: `gpt-oss-120b`,
`gemma-4-26b-a4b-it`, and `qwen3-vl-235b-a22b-instruct`. All three were verified
in the public Gateway catalog on September 12, 2026. The custom field accepts
exact catalog IDs without aliasing or substitution. Gateway owns provider routing;
provider-native and `auto/` IDs are no longer accepted (Gateway PR #144).

## Gateway handoff

The application needs one Gateway-side acceptance item before production: verify
that `response_format: {"type":"json_object"}` survives the Gateway for
`gpt-oss-120b`, with the requested model ID,
the `bibliography` app attribution, and a safe error for unsupported or
truncated output. The complete issue body is retained here because opening the
GitHub issue was blocked by the current environment usage-limit approval gate.

The Gateway's existing vision issue [#119](https://github.com/CUNY-AI-Lab/cail-gateway/issues/119)
is directly relevant to this tool's scanned-PDF path: OCR requires a working
image request through the signed `cail:gateway` leg. It should be linked to the
tool's production acceptance once the Gateway fix is verified. This tool does
not silently fall back to a browser-held provider key.

The Doorway-side work is separate: register a protected `/bibliography` page
and `/bibliography/api` route with audience `cail:bibliography`, gateway
identity enabled, current Admission checks, and the canonical tools origin.

## Outbound requests besides the Gateway

The Worker makes ordinary `fetch()` calls to two fixed groups of public hosts, never
to an address a person supplies:

- **Website import** (`/api/source`): only `SCRAPE_HOSTS`
  (`italianamericanimprints.omeka.net`), redirects re-checked.
- **Catalog lookup** (`/api/enrich`, optional): `openlibrary.org`, `api.crossref.org`,
  `www.googleapis.com` (Google Books, keyless) and `www.wikidata.org`, fixed in
  `server/worker.js` and narrowed by the `CATALOG_HOSTS` variable. Each request is
  HTTPS-only with manual redirects re-checked against the list (at most two),
  an 8 s deadline of its own, a bounded JSON body, and a User-Agent naming the tool
  and `mailto:ailab@gc.cuny.edu` (Wikidata's policy, Crossref's polite pool). The
  page sends only an entry's type, title, first creator, year, DOI/ISBN, series or
  site name and URL; the URL is compared with Wikidata's official website, never
  fetched. Matching, merging and failure wording follow the Lab's Zotero plugin
  (CUNY-AI-Lab/zotero-autofill v1.1.2): books go to Open Library, Crossref (book
  types) and Google Books in parallel, then Open Library's free-text search as a
  last resort; articles, chapters, papers, reports and theses to Crossref by type;
  a DOI to Crossref directly; films, broadcasts, recordings, software, datasets,
  maps and web pages or digital projects to Wikidata (`wbsearchentities` plus
  `wbgetentities`). A source's 429, 5xx or timeout is reported by name and never
  shown as "not found". Types no catalog covers are reported without a request.
- **Google Books key** (optional Worker secret `GOOGLE_BOOKS_API_KEY`): sent only to
  `www.googleapis.com` as `X-Goog-Api-Key`, never in a URL or reply. Without it Google
  Books is keyless and, in practice, refused.
- **Cache**: catalog replies are public data and are cached across users, keyed by a
  hash of source and request URL: 24 h for records, 10 min for empty replies, never for
  refusals, server errors or timeouts. An in-isolate LRU always applies; the Cache API
  (`caches.default`) is used as well. Cloudflare documents the Cache API as working for
  Workers on custom domains; whether it stores anything for a Worker reached only through
  a service binding is unverified. Cache state is never returned to the page: the
  cache is shared, so it would tell one person what another looked up recently.

## Verification boundary

Local automated tests can exercise the real identity verifier with signed test
assertions and the real CAIL client against a controlled HTTP receiver. They do
not prove live Doorway/Gateway integration, personal spend attribution, or model
quality. Production acceptance requires an ordinary member to sign in, convert
citations and a scanned page, observe the shared delayed quota, and import the
download into Zotero. Revocation and missing/invalid identity must fail closed.

## Private receiver release

The web receiver is the `cail-bibliography` Cloudflare Worker in `wrangler.toml`,
with its built `ASSETS` binding. It needs no Node server or database. Production
releases use the **Check and private release** GitHub workflow, manually dispatched
from `main` with its exact current 40-character SHA. The check job runs without
production credentials. The serialized release rejects a stale SHA before deploy,
then verifies the latest version serves 100%, its commit/configuration bindings,
and disabled workers.dev/preview ingress through the Cloudflare API.

Configure the repository's production environment with `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and the fleet's pinned `CAIL_IDENTITY_JWKS`. The workflow
validates the verifier configuration and installs that secret with the Worker
version; it does not generate keys or create a public route. Production environment
access and author merge permission are prerequisites, not supplied by this patch.
The platform version tag/message identify the checked commit; readiness reports
`CF_VERSION_METADATA` from the deployed runtime.

Before enabling Doorway's public mount, exercise the deployed Worker through a
private service binding: GET the canonical `/bibliography/health` and require the
expected version ID and commit tag, ready status, valid verifier configuration, and an
available HTML index asset. Readiness makes no Gateway/model calls. Also verify
missing credentials fail closed on `/bibliography/api/session`, and matching signed
app/Gateway legs can load the session and assets. The authenticated bare mount
redirects to `/bibliography/`, preserving the query, so relative assets and API
requests stay under the protected prefix. Do not enable workers.dev or preview
URLs to run these probes.

The CI control-plane readback does not exercise that private binding, prove
Admission revocation, or prove a member conversion. Record private runtime probe
results before Doorway enablement, then record member conversion, shared quota,
PNG/JPG/scanned-PDF OCR, download/Zotero import, and revoked-identity denial on the
actual public path. Those acceptance checks remain pending until performed.

The `@cuny-ai-lab/*` packages are public on npm. The checked-in `.npmrc` points
that scope at `https://registry.npmjs.org`, so installs and CI need no token or
package-read secret.

The optional `integration/run.mjs` harness preserves the September 8 native-ID
Gateway fixture. It is historical coverage, not a current Gateway acceptance test:
canonical routing now requires the Gateway's newer identity graph fixtures. Do not
use that harness to claim current deployment readiness. The standalone suite tests
the current selectors, canonical-ID forwarding for parsing/OCR, legacy-ID rejection,
identity, and quota behavior against controlled Gateway responses. Live model and
deployed Gateway acceptance remain with the infrastructure owner.
