# QA readiness review — 13 November 2026, round 3 remediation

**Live AI completion is still unverified for this release.** Round 3 confirmed the link, insurance-expiry and HTTP error fixes worked live. It isolated fast Gemini HTTP 400 `INVALID_ARGUMENT` failures to profile verification and application preflight, plus a roughly 25-second grounded-search deadline. Reading profiles and importing grants succeeded, so this release does not replace the API key or model.

## Changes

- **Provider request schemas:** structured output now uses Gemini's native `responseSchema` with uppercase primitive types, properties, required fields, array items, enums and native nullable fields. Previously the app sent Zod's full JSON Schema through `responseJsonSchema`. The adapter omits JSON Schema dialect declarations, `additionalProperties`, `anyOf` null unions and length/count constraints from the provider request. The complete original Zod schemas still validate the returned data locally, so strict keys, lengths, counts, numeric limits and missing-field rules remain enforced before any save/approval.
- **400 diagnostics:** `providerMessage` reconstructs the validation issue and rejected field/path from Gemini's message and BadRequest field violations. It never dumps arbitrary message text, quoted source values, binary data or the request body. Existing HTTP status, canonical error code, error type and support reference remain available. A fresh failure can therefore identify the rejected parameter without recording private evidence.
- **Search:** asks for at most three current source-backed opportunities using one focused search and short descriptions, with a 1,536-token output ceiling instead of 4,096. The existing 25-second model / 27-second request limit remains in place to respect the synchronous function envelope. Search timeouts now suggest retrying or adding official guidelines, with no advice about reducing documents.
- **Daily AI allowance:** authentication, source reading/conversion, source fingerprints/receipts and deterministic input/evidence checks run before `claim_ai_request`. Rejected files and other local failures no longer consume the daily AI allowance. A real attempted provider call still consumes a request, including provider rejection or timeout. Retries stay within that single phase's claim. Historical usage is not refunded.
- **Document library:** expired dates are explicitly labelled `Expired`, using the same Melbourne-calendar boundary as the mandatory-insurance gate. Spreadsheet rejections distinguish the 20-sheet and 20,000-populated-cell limits.

The exact field named by the **previous live 400 responses is not available** in this environment. Native-schema requests are a compatibility correction supported by the installed SDK contract, rather than proof that a specific old field caused every rejection. The next live test must establish whether Gemini accepts them; if it does not, the new field diagnostic is the next evidence to inspect. The existing alias/model choice, secrets and shared service settings remain unchanged.

## Verification

| Check                  | Result                             | Scope                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | 221/221 passed across 15 files     | Real-SDK mocked-HTTP tests cover the actual native-schema request bodies for the two failing stages and safe validation diagnostics; API tests cover quota placement, retries, source bindings and write guards |
| `npm run test:browser` | 74/74 passed in Chromium           | Includes relevant search-timeout recovery and expired/current labels, plus existing profile, grant, sign-in and insurance workflows with simulated services                                                     |
| `npm run build`        | Passed                             | TypeScript and production frontend                                                                                                                                                                              |
| Function packaging     | Four packaged/imported for Node 22 | POST endpoints reject GET with 405; scheduled digest imported, not invoked                                                                                                                                      |
| `npm run db:check`     | Passed                             | Installer/upgrade still match canonical SQL; no SQL changes                                                                                                                                                     |

Parser regressions include real generated Office archives, a 21-sheet workbook, a dense 20,002-cell workbook, cached/unavailable/error formula values, malformed/renamed files and bounded source handling. API regressions demonstrate zero quota claims and zero model calls for 413/415/422 file rejections. The six database scenarios passed earlier on 13 November and were not rerun for this release because SQL is unchanged.

## Deployment and next live check

Push this revision to GitHub `main` for the existing Netlify production pipeline, which prior live rounds have confirmed publishes these pushes. Confirm the new published commit before retesting. No new migration, environment variable, provider key or dependency installation is required.

1. Complete both profile controls: Word/Excel sources and TXT/PDF sources. Then complete draft preflight and generation with actual questions and word limits.
2. Run grant search and verify each result against its cited source. Smaller workload is a latency mitigation, not a live success guarantee.
3. If a 400 remains, inspect the **new** reference's `providerMessage`, status and code. Historical logs cannot recover discarded message text. Do not change a working key/model merely because an individual stage rejects a schema.
4. Recheck spreadsheet formula fidelity through a completed profile, and draft answers against their word limits. Invalid-file checks should leave the daily allowance unchanged.

Hosted cross-account checks, isolated digest delivery and optional receiving-email delivery remain open from previous reports. Email intake stays hidden until its DNS/MX and receiving/webhook round trip are configured and tested. No organisations, documents, live records or shared settings were deleted or modified during this local work.

This executor has no production credentials or Netlify plug-in. Public-site HTTP access is blocked with proxy CONNECT 403, and the linked round-3 artifact is also inaccessible here (HTTP 403), so the supplied chat report is the live evidence used. Local simulated provider success is not a claim of real Gemini success or completed Netlify publication.
