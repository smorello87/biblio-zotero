# Tests

`npm test` runs every `tests/*.test.mjs` file with the Node test runner. Nothing here calls a model, the Gateway or Cloudflare: every upstream is stubbed.

- `worker.test.mjs`: the Worker handler in Node (identity, Origin checks, model calls, output budgets, catalog cache, enrich, source import, error envelopes).
- `workerd.test.mjs`: the bundled Worker in real workerd through Miniflare (enrich, abort propagation with and without `enable_request_signal`, `LICENSE.txt`).
- `api.test.mjs`: the browser API client (lost-session restart and sign-in link, retry advice, timeouts).
- `models.test.mjs`: catalog-driven model menus, including a snapshot of the public catalog in `fixtures/`.
- `core.test.mjs`: entry splitting, reconciliation, model-reply parsing and RIS export.
- `verify-release.test.mjs`: `scripts/verify-release.mjs` against `fixtures/cloudflare-api-stub.mjs`.
