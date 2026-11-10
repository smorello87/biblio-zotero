# Deploy checklist

Bibliography is deployed in two steps, receiver first. The receiver is the
`cail-bibliography` Cloudflare Worker from this repository. Doorway (in
`CUNY-AI-Lab/cail-tools-admission`) mounts it at `/bibliography/`. Do not release
the Doorway mount until the receiver is deployed and verified. See
`docs/CAIL-INTEGRATION.md` for the architecture and acceptance boundary.

Names only below. Never put values in source, logs, or comments.

## 1. Receiver release (this repository)

### Secrets and variables

| Name | Kind | Where it is set | Used by |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | GitHub repository `smorello87/biblio-zotero`, Settings, Environments, `production` | `wrangler deploy` and `scripts/verify-release.mjs` |
| `CLOUDFLARE_ACCOUNT_ID` | secret | same `production` environment | same; must be the CUNY AI Lab account that holds `cail-doorway`, because service bindings only resolve within one account |
| `CAIL_IDENTITY_JWKS` | secret | same `production` environment | the release job validates it for both audiences (`cail:bibliography`, `cail:gateway`), then installs it on the Worker as a secret via `--secrets-file`. It must be the fleet's pinned verifier key set, identical to the one Doorway signs against |
| `GOOGLE_BOOKS_API_KEY` | secret, **optional** | same `production` environment | when present, the release installs it on the Worker via `--secrets-file` and Google Books lookups use the Lab's quota (sent only to `www.googleapis.com`, only as `X-Goog-Api-Key`). When absent, nothing is written and lookups stay keyless. Not checked by `verify-release.mjs`. See *Google Books key* below |
| `GH_TOKEN` | automatic | `github.token` | stale-SHA checks against `main` |
| `RELEASE_SHA`, `RELEASE_SECRETS_FILE` | job-local | set by the workflow | not configured by hand |

No package-read token is needed any more: `@cuny-ai-lab/*` installs from public npm.
Also in GitHub: the `production` environment needs required reviewers (or equivalent
protection), and `main` must allow the author to merge. Both are prerequisites outside this repo.

### Google Books key (optional)

Keyless Google Books requests are refused: on 2026-11-10 Google attributed them to a shared project whose
per-day quota is 0 (`quota_limit_value: "0"`, `defaultPerDayPerProject`), so without a key Google Books
always reports "refused the request (rate limit)". A key gives the Lab's own project quota. Google's Books
API documentation does not state the default daily quota; check it in the Google Cloud console under the
Books API's quotas.

1. In the Google Cloud console create an API key in a Lab project with the Books API enabled. Restrict it to
   the Books API (API restrictions); an IP or referrer restriction will not work from Cloudflare.
2. Store it as the `production` environment secret, from the clipboard on macOS:
   `pbpaste | tr -d '\r\n' | gh secret set GOOGLE_BOOKS_API_KEY --env production --repo smorello87/biblio-zotero`
3. Re-run the release (step 2 below) for the current `main` SHA. The secrets step rejects a malformed key
   (without printing it).
4. Check: a lookup for a book shows Google Books results, or "the Lab's Google Books quota is used up for
   today" once the quota is spent.

Rotate: create the new key, repeat steps 2 and 3, then delete the old key in the Google Cloud console.
Remove: delete the GitHub secret (`gh secret delete GOOGLE_BOOKS_API_KEY --env production --repo
smorello87/biblio-zotero`). A release never deletes a Worker secret (`--secrets-file` is additive), so also
delete it from the Worker: `npx wrangler secret delete GOOGLE_BOOKS_API_KEY --name cail-bibliography` (or the
dashboard). That deploys an untagged version, so re-run the release for the current `main` SHA straight
after, to restore a tagged, verified version. Lookups then go back to keyless.

### `wrangler.toml` values that must stay pinned

- `name = "cail-bibliography"` must equal the service name in Doorway's binding and in
  `scripts/verify-release.mjs`.
- `main = "server/worker.js"`; `[assets] directory = "./dist"`, `binding = "ASSETS"`,
  `run_worker_first = true`.
- `compatibility_date = "2026-09-07"` and `compatibility_flags = ["enable_request_signal"]`.
  `verify-release.mjs` asserts the date and the exact flag list. The flag is needed until a date of 2026-11-17 or
  later makes it the default; without it a caller abort does not reach the Gateway call.
  Changing the date is an owner decision: re-run the workerd tests when you do.
- `workers_dev = false` and `preview_urls = false` (the verifier fails otherwise).
- `[vars] CAIL_IDENTITY_ISSUER = "https://tools.ailab.gc.cuny.edu/cail-sso"` (asserted by the verifier).
- `[vars] SCRAPE_HOSTS` is the import allowlist (only `italianamericanimprints.omeka.net`; asserted by the verifier).
- `[vars] CATALOG_HOSTS = "openlibrary.org,api.crossref.org,www.googleapis.com,www.wikidata.org"` is the catalog
  lookup allowlist (asserted by the verifier; it can only narrow the fixed list in `server/worker.js`). Removing a host
  switches that source off and the page reports it as "not enabled".
- `[version_metadata] binding = "CF_VERSION_METADATA"`.
- `[[services]] binding = "GATEWAY"`, `service = "cail-model-api"` (asserted by the verifier). Every Gateway call
  (chat, quota, catalog) goes through it. A global `fetch()` to `https://tools.ailab.gc.cuny.edu/v1/...` from a Worker
  in the same zone is routed to the zone's origin, not the Gateway Worker, and returns 404 (the 2026-11-09 outage).
  `/bibliography/health` reads the public catalog through the binding and returns 503 `gateway_unavailable` if it
  cannot, so the readiness probe after each release exercises the Gateway path.
- The `CAIL_IDENTITY_JWKS` secret is not in the file; the release installs it.
- No `account_id`, routes, or custom domain: the Worker has no public origin and is reached only by
  Doorway's service binding.

### Release steps

1. Merge the reviewed change to `main`; wait for the **Check and private release** `check` job
   (npm ci, `npm run check`, `wrangler deploy --dry-run`).
2. Dispatch the workflow from `main` with the exact current 40-character SHA. It rejects stale
   SHAs, validates identity configuration, deploys with `--strict --tag <sha>`, and runs
   `scripts/verify-release.mjs` (one version at 100%, tag and message equal the SHA, secret and
   assets bindings present, issuer, import and catalog allowlists, compatibility date and flags as pinned, workers.dev and
   previews off).
3. Private readiness probe (needs a service binding or Doorway; do not enable workers.dev):
   `GET https://tools.ailab.gc.cuny.edu/bibliography/health` with a valid signed app and Gateway leg.
   Require `status: "ready"` and the `version_id` and `tag` of the release. Also confirm
   `/bibliography/api/session` without credentials returns 401 `authentication_required`.
4. Record the version ID and sanitized outcome. This is control-plane and readiness evidence only.

## 2. Doorway mount (`CUNY-AI-Lab/cail-tools-admission`, not changed here)

Reference: closed PR 183 ("Prepare protected Bibliography mount after receiver deployment") is stale. Doorway
`main` (read at `1bf54e0`) has since added more mounts (PDF Accessibility, Library Assistant) and a
route-contract table in `policy.ts`. Reapply it against current `main`, using the PDF Accessibility mount as
the template. All paths below are under `apps/doorway/` unless noted.

1. `wrangler.toml`: add
   ```toml
   [[services]]
   binding = "BIBLIOGRAPHY"
   service = "cail-bibliography"
   ```
2. `config/route-policy.json`
   - `tools`: add `{ "id": "bibliography", "label": "Bibliography", "steward": "CUNY AI Lab", "landingPath": "/bibliography/", "listed": true }`.
   - `routes`: add `bibliography-api` (`match: prefix`, `path: /bibliography/api`, `access: authenticated`,
     `requestKind: api`, `identityMode: jwt`, `toolId: bibliography`, `audience: cail:bibliography`,
     `gatewayIdentity: true`) before `bibliography-page` (same, `path: /bibliography`, `requestKind: page`).
     Keep the API route before the page route, as `media-tools-api` precedes `media-tools-page`.
3. `src/policy.ts`: add the same two entries to `GATEWAY_ROUTE_CONTRACTS`. `validateGatewayRoute` rejects any
   `gatewayIdentity` route not listed there.
4. `src/config.ts`: add `BIBLIOGRAPHY?: ServiceFetcher` to `WorkerEnv`, `bibliography: ServiceFetcher` to
   `DoorwayConfig`, and `bibliography: requiredService(env.BIBLIOGRAPHY, "BIBLIOGRAPHY")` in `loadDoorwayConfig`
   (required, like `pdfAccessibility`; PR 183 had it optional).
5. `src/doorway.ts`: add `const BIBLIOGRAPHY_ROUTES = new Set(["bibliography-page", "bibliography-api"])`, add
   `"bibliography"` to `MountOwningService`, and `[BIBLIOGRAPHY_ROUTES, "bibliography"]` to `MOUNT_OWNING_SERVICES`
   (this forwards the original path including `/bibliography`). No change to `protectedPageMethodError`: pages are
   GET/HEAD, and the receiver enforces GET/HEAD/POST on its API.
6. Gateway usage attribution is optional and can follow later. The tool allowlist `GATEWAY_TOOLS` in
   `src/identity.ts` omits unlisted tools, so Bibliography's Gateway leg carries no `tool` claim and its calls
   are reported as unattributed, though the receiver still sends `x-cail-app: bibliography`. Adding it also
   needs the Admission `tool` CHECK in `apps/admission/src/registry-schema-v24.ts` (a migration) and
   `apps/admission/src/types.ts`, `packages/admission-contract/src/self.ts`. Decide this with Admission's owner.
7. Release plumbing:
   - `scripts/release/doorway.sh`: `check_service BIBLIOGRAPHY cail-bibliography ""` beside `MEDIA_TOOLS`;
     add `"BIBLIOGRAPHY"` (sorted) to the exact service-binding `jq` list; add `/bibliography/` to the login-redirect
     loop; add `probe_mounted_auth "$origin/bibliography/api/session" '/launch/bibliography'` plus the
     forged-header variant.
   - `.github/workflows/doorway-release.yml` (the PR 183 diff changed it; check whether current `main` still carries
     the same lists) and `docs/workflows/README.md` (a "Bibliography mount" section modelled on "Media Tools mount",
     with the receiver-first order).
   - `apps/doorway/README.md` and `AGENTS.md`: short paragraph as in PR 183.
8. Tests to add or update:
   - `test/decision.test.ts`: `/bibliography`, `/bibliography/`, `/bibliography/health` resolve to
     `bibliography-page`; `/bibliography/api`, `/bibliography/api/parse` to `bibliography-api`;
     `/bibliographyx` and `/bib` are denied.
   - `test/runtime/products.ts`: add `"bibliography"` to the product names and a `BibliographyDouble`
     `WorkerEntrypoint`; `vitest.config.ts`: `BIBLIOGRAPHY: "BibliographyDouble"`;
     `test/doorway-env.ts`: `BIBLIOGRAPHY: service`.
   - `test/runtime/identity-legs.test.ts`: add `["/bibliography/api/session", "bibliography", "/bibliography/api/session",
     "cail:bibliography"]` to the app-leg and Gateway-leg table (same subject, same lifetime, forged headers stripped);
     add a case for the bare `/bibliography` page.
   - `test/admission-config.test.ts` and `test/runtime/configuration.test.ts`: add `BIBLIOGRAPHY` to the
     required-binding lists.
   - `test/browser/welcome.spec.ts`: the "Your tools" rack is built from listed tools in policy order, so add
     `["Bibliography", "/bibliography/"]` at the position the new entry takes.
   - `test/integration/release-components.test.ts`: add `["BIBLIOGRAPHY", "cail-bibliography", ""]` to the
     expected service bindings and the bibliography probe routes to the fake origin.
   - Run the root `bun run check` there.
9. Doorway already sets `enable_request_signal` and `request_signal_passthrough`, so an abort at Doorway reaches
   the receiver and then its Gateway call.

## 3. After the Doorway release

The release job has no CUNY session. A real admitted member must then, on the public path: sign in and open
`/bibliography/`; convert citations with each default model; OCR a PNG/JPG and a scanned PDF; see the shared
delayed quota; download CSL-JSON and RIS and import into Zotero; stop a conversion mid-flight and confirm the
Gateway call is cancelled; confirm a revoked identity is denied. Record Doorway and receiver version IDs and a
sanitized outcome. Gateway acceptance items in `docs/CAIL-INTEGRATION.md` (JSON-object passthrough for
`gpt-oss-120b`, vision issue 119) must be confirmed first.
