# CAIL bibliography integration

The web tool is moving from browser-held OpenRouter keys to CAIL Doorway and
Gateway. The Python CLI remains an independent command-line utility.

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

The curated model choices are provider-native Gateway IDs: `@cf/openai/gpt-oss-120b`
for general bibliography parsing, `@cf/google/gemma-4-26b-a4b-it` for a CAIL
Workers AI option, and `qwen/qwen3-vl-235b-a22b-instruct` for difficult scanned
pages. The custom model field accepts another provider-native ID without aliasing
or silent substitution.

## Gateway handoff

The application needs one Gateway-side acceptance item before production: verify
that `response_format: {"type":"json_object"}` survives the Gateway for both
`openai/gpt-oss-120b` and `@cf/openai/gpt-oss-120b`, with the requested model ID,
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

## Verification boundary

Local automated tests can exercise the real identity verifier with signed test
assertions and the real CAIL client against a controlled HTTP receiver. They do
not prove live Doorway/Gateway integration, personal spend attribution, or model
quality. Production acceptance requires an ordinary member to sign in, convert
citations and a scanned page, observe the shared delayed quota, and import the
download into Zotero. Revocation and missing/invalid identity must fail closed.
