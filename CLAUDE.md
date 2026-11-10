# CLAUDE.md

Guidance for working in this repository. Read `docs/CAIL-INTEGRATION.md` for the full integration contract and release process.

## What this is

A Cloudflare Worker (`server/worker.js`) serving a static page and a small API under `/bibliography`. It runs inside CUNY AI Lab's Doorway/Gateway platform behind CUNY Login. No key is held in the browser.

Test source: `https://italianamericanimprints.omeka.net/actual-bibliography`.

## Layout

- `index.html`, `styles.css`, `assets/`: static page. `app.js` is the entry and imports `browser.js` (UI), `api.js` (API client, sign-in restart), `models.js` (model menus), `core.js` (entry splitting, CSL-JSON/RIS), `readers.js` (TXT/DOCX/PDF/image readers).
- `server/worker.js`: API routes (`session`, `quota`, `catalog`, `parse`, `ocr`, `enrich`, `source`, `health`). `server/prompts.js`: model prompts. `server/lookup.js`: catalog lookup for `enrich` (pure; the Worker supplies an allowlisted fetcher).
- `scripts/build.mjs`: bundles into gitignored `dist/` (served via the `ASSETS` binding). `wrangler.toml`: Worker config.
- `docs/DEPLOY-CHECKLIST.md`: secrets, pinned config, probes and the Doorway mount changes.
- `tests/*.test.mjs`: Node test runner (`workerd.test.mjs` runs the Worker in real workerd via Miniflare; `tests/fixtures/` holds a public catalog snapshot and a Cloudflare API stub). `integration/`: optional workerd-to-Gateway harness that needs external Gateway source.

## Commands

```bash
npm ci                          # packages are public on npm; no token needed
npm run check                   # syntax checks, all tests, then build
npm test                        # tests only
npm run worker:dev              # build + wrangler dev
npx wrangler deploy --dry-run   # offline bundle check (never deploy locally; releases go through CI)
```

## Identity and Gateway flow

Doorway handles CUNY login and Admission, then forwards two signed JWTs to the Worker over a service binding: an app assertion (audience `cail:bibliography`) and a Gateway leg (audience `cail:gateway`, same subject). The Worker verifies both with `@cuny-ai-lab/cail-identity`, rejects mismatches, requires `Origin` on writes, and forwards only the Gateway leg to Gateway through `@cuny-ai-lab/cail-client` (single attempt, no app-key fallback) over the `GATEWAY` service binding to `cail-model-api`. Never call the Gateway with global `fetch()`: from a Worker in the same zone it reaches the zone origin and gets 404. `/bibliography/health` proves the binding by reading the catalog through it. Gateway owns model routing, accounting and quota; the Worker keeps no spending ledger. Every Worker `401` names `launch: "/launch/bibliography"`. A `401` with `authentication_required` or `session_invalid` makes the page navigate to that launch path (once per page, at most once a minute, and only when sessionStorage can record it); the error banner and session status always show a "Sign in with CUNY" link as well (`api.js`).

## Models

Model IDs are canonical and prefix-free Gateway IDs. Provider-prefixed or `auto/` IDs are rejected. The default for each menu is chosen by rule (owner, 2026-11-10): the offered model with the lowest catalog `order`, which on 2026-11-10 is `deepseek-v4.1-flash-1017` for both parsing and OCR; a model the person picked is kept while it is still offered. The built-in fallback lists (`models.js`, mirrored in `index.html`) start with that model: parse `deepseek-v4.1-flash-1017`, `gpt-oss-120b`, `gemma-4-26b-a4b-it`, `qwen3-vl-235b-a22b-instruct`; OCR `deepseek-v4.1-flash-1017`, `gemma-4-26b-a4b-it`, `qwen3-vl-235b-a22b-instruct`. The owner approved catalog-driven menus limited to recommended models (2026-11-09): the page offers only catalog rows marked `recommended` that have `text-generation` (plus `vision` for OCR), are active, have a `context_length` of at least 32,000 tokens and are not guard/safeguard classifiers, in catalog `order` (`models.js`). It falls back to the built-in lists when the catalog is unavailable or nothing qualifies; any other Gateway model stays reachable through "Other Gateway model ID", whose suggestions list every text-generation row. Output budgets come from the model's catalog row (`modelControls` in `server/worker.js`): reasoning models get `reasoning_effort: "low"` (Gateway-gated on the `reasoning` capability; plus `chat_template_kwargs.enable_thinking: false` on Workers AI) and `max_tokens` of 4,000 headroom + 250 per entry (4,000 for OCR), capped at 10,000 so a reply fits the 180 s deadline; non-reasoning Workers AI routes (Chat default 256 tokens) and unlisted models get 16,000 and no reasoning controls; other non-reasoning routes keep their provider default. All budgets are capped at half the catalog `context_length`. The catalog read is shared per isolate, has a 5 s deadline of its own and is cached for 10 minutes (a failed read for 30 s). An exhausted budget is `model_output_limit`; a timeout message advises fewer entries or another model. `wrangler.toml` enables `enable_request_signal` so a caller abort reaches the Gateway call. Do not change which models are offered by default or the compatibility date/flags without the owner's decision.

## Catalog lookup

`/api/enrich` follows the Lab's Zotero plugin (CUNY-AI-Lab/zotero-autofill v1.1.2, `src/modules/enrichment.ts`): keep the two in step. `lookupPlan` in `core.js` decides the sources by CSL type: books → Open Library (structured, then `q=` as a last resort), Crossref (book types) and Google Books (keyless) in parallel; articles, chapters, papers, reports, theses → Crossref by type; any DOI → Crossref directly (accepted only if its title matches); films, broadcasts, recordings, software, datasets, maps, web pages/digital projects → Wikidata (`wbsearchentities` + `wbgetentities`, `en|mul` labels); everything else → "No catalog covers this kind of source; kept as written", with no request. Candidates merge on ISBN/DOI or main title + first-creator surname + year; titles match subtitle-tolerantly, authors by surname; several plausible records are offered as choices, never picked. Wikidata matches need the label, a fitting type, and no contradicting year, creator or series; one confirmed by year, creator, series or the cited website is a match, others are choices. A source's failure is named ("Google Books refused the request (rate limit)") and is never "not found". Outbound hosts are fixed (`CATALOG_HOSTS`, asserted by `verify-release.mjs`); `tests/fixtures/` holds recorded replies (`scripts/record-*.mjs` re-record them live; not part of `npm test`).

RIS export (`toRIS`) maps every accepted CSL type to the RIS type Zotero's RIS translator imports correctly, with creators and fields on the tags Zotero reads for that type; `tests/ris.test.mjs` checks this against trimmed Zotero tables.

## Constraints

- License is GNU GPL v3; keep the footer credit and GitHub link.
- Keep the CUNY blue theme (`--primary-blue: #003DA5`, `--secondary-blue: #002D72`).
- Tests stub every upstream; never call a model or paid API from tests or local runs.
- Never commit secrets or `.env`. Do not push or deploy from a local session.
- `WEB_APP_*.md` and other top-level summary docs are historical notes from the earlier browser-key version.
