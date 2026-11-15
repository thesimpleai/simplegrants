# QA readiness review — round 5 remediation

**Ready for the next controlled live test; general-user readiness remains unconfirmed.** The supplied report confirms revision `1a59bfa` is live: the compact preflight no longer exhausts its output limit and new discovery results save canonical source links. Five of eleven AI calls instead stopped at 25–27 seconds. No live draft with spreadsheet evidence has completed yet.

## Changes

- **Background AI phases:** profile preparation, discovery, import, application drafting and report preparation now queue each phase once in a Netlify Background Function. The browser polls for the result while retaining the existing stage progress. Gemini receives a 90-second timeout within a 120-second phase budget. The old synchronous endpoint remains compatible for older clients; chat retains its short synchronous budget. Merely extending a synchronous request would exceed the installed Netlify runtime's documented 30-second limit.
- **Same safeguards and allowance:** the worker runs the existing authenticated handler, including original-source fingerprints, signed inter-stage receipts, file validation, guideline blockers, and optimistic application updates. An atomic claim prevents duplicate worker delivery from repeating the phase or charging it twice. Polling does not claim AI quota. Local file rejection still precedes quota claiming. A user-initiated retry restarts the flow and claims its phases as before.
- **Temporary private jobs:** metadata, payload, claim and result live under `.ai-jobs/<org>/<job>/` in the existing private bucket. The non-UUID first path segment makes the existing restrictive Storage policies reject browser access, including the organisation owner. Server reads authenticate the member and match both organisation and initiating user. Session tokens are forwarded to the configured application origin, never persisted. Original request payloads are removed after a result is saved. Results expire after 15 minutes; an hourly background cleanup removes expired job files, so physical retention is ordinarily at most 75 minutes. Cleanup never traverses the document-library paths.
- **Approved organisation facts in preflight:** the server now includes the approved profile, with the saved organisation description as fallback. The prompt uses these facts for organisation background/community-served requirements while continuing to require project-specific need, outcomes, budget and eligibility evidence. The same approved profile is already bound into the signed source fingerprint.
- **Older saved citations:** opening Grant opportunities attempts to resolve existing Google grounding redirects without Gemini or quota usage. A manual refresh remains available for unresolved or additional records. Only source URL and citation provenance change, with original redirect retained. Concurrent source/provenance edits are not overwritten. Expired/unresolvable redirects remain visibly marked for review; they are never replaced with a guessed URL.

No migration, new environment variable, provider-key change or application dependency is required. The existing service-role key must be available to the new worker/status/cleanup functions. Netlify must publish Background Functions; the packaging check recognises the worker and scheduled cleanup as background invocations. The configured `AUTH_APP_URL` is used for the worker launch as well as sign-in.

## Verification

- 267 unit tests across 21 files pass, including a simulated 35-second success through the real installed Gemini SDK with a 90-second provider deadline.
- Tests cover actor/organisation isolation, atomic duplicate delivery, repeatable result retrieval, original phase errors, expiration, cleanup scope, polling beyond 25 seconds, and stopping polls after an account/organisation change.
- Repair tests cover canonical citation preservation, unresolved URLs, concurrent edits and denied write access.
- The production build passes. All 76 existing browser workflows pass, along with both new browser workflows for background draft polling and automatic legacy-link repair.
- Both disposable database scenarios (adversarial shared policies and hosted-style policies) pass, including the new tests denying owner access to the server-only job prefix. No production database was used.
- Netlify packaging succeeds for all eight functions, recognising the worker and cleanup as background invocations and retaining the hourly cleanup schedule.
- No live Gemini requests, user-record edits or quota claims were made by these local checks.

## Live checks still required

Confirm Netlify publishes the new revision and includes `ai-worker-background`, `ai-jobs`, `ai-job-cleanup-background` and `repair-sources`. Then:

1. Open Riverbend's Grant opportunities and confirm the old Open Gardens redirect repairs, or is explicitly marked unresolved. Check the retained original citation and source URL; this repair does not use the AI allowance.
2. Run Creekside drafting with the selected TXT, DOCX and XLSX evidence. Confirm both stages complete beyond 25 seconds where needed, the approved organisation description is recognised, and genuinely missing project facts still block.
3. Review the completed draft's actual word counts and spreadsheet sheet/cell citations. Confirm saved formula values remain unverified evidence and missing/error formula results are not invented.
4. Run the MACMAA-documents profile, checking omitted facts against originals before human approval. No phase should approve the profile automatically.
5. Exercise discovery search and saving, checking the funder's canonical source and round-specific dates/eligibility.

The Cloud environment cannot reach the production site or Netlify control plane and has no production Gemini/Supabase credentials. A GitHub push starts the existing deployment integration but does not establish a successful live deployment or successful live AI calls. Full readiness depends on those remaining checks.
