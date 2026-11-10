# CLAUDE.md

Guidance for working in this repository. Read `docs/CAIL-INTEGRATION.md` for the full integration contract and release process.

## What this is

- **Web app**: a Cloudflare Worker (`server/worker.js`) serving a static page and a small API under `/bibliography`. It runs inside CUNY AI Lab's Doorway/Gateway platform. No key is held in the browser.
- **Python CLI**: `omeka_bib_to_zotero.py` is a separate, independent command-line utility with its own providers (OpenAI, OpenRouter, and the CAIL Gateway via `--provider cail`), prompts and key handling. It shares no code with the web app; changes to one do not imply changes to the other.

Test source: `https://italianamericanimprints.omeka.net/actual-bibliography`.

## Layout

- `index.html`, `styles.css`, `assets/`: static page. `app.js` is the entry and imports `browser.js` (UI), `api.js` (API client, sign-in restart), `models.js` (model menus), `core.js` (entry splitting, CSL-JSON/RIS), `readers.js` (TXT/DOCX/PDF/image readers).
- `server/worker.js`: API routes (`session`, `quota`, `catalog`, `parse`, `ocr`, `enrich`, `source`, `health`). `server/prompts.js`: model prompts.
- `scripts/build.mjs`: bundles into gitignored `dist/` (served via the `ASSETS` binding). `wrangler.toml`: Worker config.
- `docs/DEPLOY-CHECKLIST.md`: secrets, pinned config, probes and the Doorway mount changes.
- `tests/*.test.mjs`: Node test runner (`workerd.test.mjs` runs the Worker in real workerd via Miniflare). `integration/`: optional workerd-to-Gateway harness that needs external Gateway source.

## Commands

```bash
npm ci                          # packages are public on npm; no token needed
npm run check                   # syntax checks, all tests, then build
npm test                        # tests only
npm run worker:dev              # build + wrangler dev
npx wrangler deploy --dry-run   # offline bundle check (never deploy locally; releases go through CI)
python3 -m unittest tests/test_omeka_cli.py   # Python CLI tests (needs requests, beautifulsoup4)
```

## Identity and Gateway flow

Doorway handles CUNY login and Admission, then forwards two signed JWTs to the Worker over a service binding: an app assertion (audience `cail:bibliography`) and a Gateway leg (audience `cail:gateway`, same subject). The Worker verifies both with `@cuny-ai-lab/cail-identity`, rejects mismatches, requires `Origin` on writes, and forwards only the Gateway leg to Gateway through `@cuny-ai-lab/cail-client` (single attempt, no app-key fallback). Gateway owns model routing, accounting and quota; the Worker keeps no spending ledger. A `401` with `authentication_required` or `session_invalid` makes the page restart sign-in by navigating to the tool's launch path.

## Models

Model IDs are canonical and prefix-free Gateway IDs: `gpt-oss-120b` (default), `gemma-4-26b-a4b-it`, `qwen3-vl-235b-a22b-instruct`. Provider-prefixed or `auto/` IDs are rejected. The owner approved catalog-driven menus limited to recommended models (2026-11-09): the page offers only catalog rows marked `recommended` that have `text-generation` (plus `vision` for OCR), are active, have a `context_length` of at least 32,000 tokens and are not guard/safeguard classifiers, in catalog `order` (`models.js`). It falls back to these three when the catalog is unavailable or nothing qualifies; any other Gateway model stays reachable through "Other Gateway model ID", whose suggestions list every text-generation row. Output budgets come from the model's catalog row (`modelControls` in `server/worker.js`): reasoning models get `reasoning_effort: "low"` (Gateway-gated on the `reasoning` capability; plus `chat_template_kwargs.enable_thinking: false` on Workers AI) and `max_tokens` of 4,000 headroom + 250 per entry (4,000 for OCR), capped at 10,000 so a reply fits the 180 s deadline; non-reasoning Workers AI routes (Chat default 256 tokens) and unlisted models get 16,000 and no reasoning controls; other non-reasoning routes keep their provider default. All budgets are capped at half the catalog `context_length`. The catalog read is shared per isolate, has a 5 s deadline of its own and is cached for 10 minutes (a failed read for 30 s). An exhausted budget is `model_output_limit`; a timeout message advises fewer entries or another model. `wrangler.toml` enables `enable_request_signal` so a caller abort reaches the Gateway call. Do not change which models are offered by default or the compatibility date/flags without the owner's decision.

## Constraints

- License is GNU GPL v3; keep the footer credit and GitHub link.
- Keep the CUNY blue theme (`--primary-blue: #003DA5`, `--secondary-blue: #002D72`).
- Tests stub every upstream; never call a model or paid API from tests or local runs.
- Never commit secrets or `.env`. Do not push or deploy from a local session.
- `WEB_APP_*.md` and other top-level summary docs are historical notes from the earlier browser-key version.
