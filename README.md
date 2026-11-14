# Bibliography to Zotero

A CUNY AI Lab web tool that turns a bibliography into records you can import into Zotero. Paste citations, upload a TXT, DOCX, PDF, PNG or JPG file, or import from an enabled bibliography website. Check where each citation begins, then convert. The tool returns CSL-JSON or RIS, shows each record beside its original citation for review, and can look entries up in Open Library, Crossref, Google Books and Wikidata to suggest missing metadata for review.

## Where it runs

The tool is served at `https://tools.ailab.gc.cuny.edu/bibliography/` on the CUNY AI Lab tools portal. You sign in through CUNY Login, and conversion and Vision OCR use your shared CUNY AI Lab model allowance. No API key is held in the browser.

It is a Cloudflare Worker (`server/worker.js`) with static assets. The Worker has no public address of its own. The portal (CAIL Doorway) handles sign-in and access, then forwards two signed identity assertions over a service binding. The Worker verifies both and calls models through the CAIL Gateway on your behalf. See [`docs/CAIL-INTEGRATION.md`](docs/CAIL-INTEGRATION.md).

Files and results stay in your browser tab. Text sent for conversion, page images sent for OCR and optional catalog lookups leave the browser for processing. Review every record against its source before importing it.

## Open edition

An open edition runs anywhere as a static site, with no backend and no CUNY account. People choose an OpenAI-compatible endpoint (OpenRouter, OpenAI, Google Gemini, Groq, Mistral, Together AI, a local server such as Ollama or LM Studio, or any other URL) and bring their own key, which stays in their browser. Conversion, OCR and catalog lookups go from the browser straight to the endpoint and the catalogs. Website import is left out, because bibliography sites do not allow cross-origin requests. The CUNY AI Lab Gateway is not offered as an endpoint either, for the same reason: CUNY users have the edition above.

It shares every page module with the CAIL edition. `edition.js` holds what differs (the API client, the account panel and a few strings); `scripts/build-open.mjs` bundles `open/edition.js` in its place, uses `open/index.html` and `open/styles.css` (styled after stefanomorello.com), and fails if any CAIL-only module reaches the bundle. The model menus come from each endpoint's live model list: every current-generation model in the DeepSeek, GPT OSS, Gemma and Qwen VL families (`FAMILIES` in `open/api.js`), so new releases appear without a code change. `open/api.js` keeps the same `api(path, body, signal)` contract as `api.js` and runs the shared prompts and `server/lookup.js` in the browser.

```bash
npm run build:open              # writes dist-open/; upload its contents to any static host
```

It is published at `https://stefanomorello.com/tools/biblio-zotero/`.

## Develop

Requires Node.js 22.

```bash
npm ci                          # CAIL packages are public on npm; no token needed
npm run check                   # syntax checks, all tests, then the build into dist/
npm test                        # tests only
npm run dev                     # build and serve dist/ at http://127.0.0.1:8000 (page only, no API)
npm run worker:dev              # build and run the Worker locally with wrangler dev
npx wrangler deploy --dry-run   # offline bundle check
```

The tests stub every upstream and never call a model. `tests/workerd.test.mjs` runs the bundled Worker in real workerd through Miniflare. `integration/run.mjs` is an optional harness against a local copy of the Gateway source (`CAIL_GATEWAY_SOURCE`).

Layout:

- `index.html`, `styles.css`, `assets/`: the page. `app.js` loads `browser.js` (interface), `api.js` (API client and sign-in restart), `models.js` (model menus from the Gateway catalog), `core.js` (entry splitting, CSL-JSON and RIS) and `readers.js` (file readers, PDF rendering for OCR).
- `server/worker.js`, `server/prompts.js`: the Worker routes and model prompts.
- `scripts/`: build, local server and release verification.
- `docs/`: integration contract and deploy checklist.

Releases go through the GitHub Actions workflow only, never from a local machine. See [`docs/DEPLOY-CHECKLIST.md`](docs/DEPLOY-CHECKLIST.md).

## Licence

GNU General Public License v3.0 (see `LICENSE`). Developed by Stefano Morello for the CUNY AI Lab.
