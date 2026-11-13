# QA readiness review — 13 November 2026

**The latest live retest still blocks a real-user launch.** The supplied report confirms Netlify published `3620e69` automatically, but only two of five AI calls succeeded and neither a profile nor an application draft finished. This release fixes a reproduced SDK transport defect, the confirmed legacy-link mismatch, and insurance expiry entry/validation. Actual provider reliability still needs a live retest after publication.

## Fixes after the latest retest

- **AI HTTP errors and retries:** the locked `@google/genai` 1.52.0 SDK's `retryOptions: { attempts: 1 }` discards non-2xx responses before its normal `ApiError` parser. A local reproduction with a simulated HTTP 429 produced an `Error` with no status; omitting that setting produced `ApiError` with status 429. Both client-level and request-level SDK retry options are now removed. Our existing bounded retry can therefore recognise actual HTTP 500/502/503, while quota/auth/validation failures remain single attempts. The original 27-second request deadline and write guards remain in force.
- **Safe diagnostics:** failed portal calls now log the numeric provider HTTP status, fixed error type and allowlisted canonical provider code such as `RESOURCE_EXHAUSTED`, together with the existing support reference. Raw SDK messages, error details, credentials and source documents are not logged. Provider configuration/validation failures direct the user to support instead of suggesting repeated retries.
- **Grant return links:** the reported URL used `opportunity=`, while the app only accepted `grant=`. Both forms now resolve to the same validated UUID; sign-in emails and expired-link recovery canonicalise to `grant=`. Logged-in legacy links open the selected grant too. Conflicting/repeated parameters are rejected, and explicit organisation changes clear both forms.
- **Insurance expiry:** users can enter an expiry during insurance upload and edit existing documents using their calendar button. Mandatory insurance stays blocked until a valid current expiry is recorded, including in the server's source-based and model-assisted preflight checks. Missing, malformed and expired dates do not count. Saving checks the returned tenant-scoped row before updating the screen; refused saves leave the editor open. Dates are user-reviewed metadata, not verification of coverage.

No new database migration, provider key, environment variable or dependency update is required. Existing insurance records with no expiry need the date entered from their original certificate before they can satisfy a mandatory insurance requirement. No dates are invented or backfilled. Existing optional/conditional requirement handling remains in place.

## Verification of this release

| Check                  | Result                             | Scope                                                                                                                                                                  |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | 214/214 passed across 15 files     | Includes nine tests through the real installed Gemini SDK with mocked HTTP, plus evidence, parser, access, privacy and workflow regressions                           |
| `npm run test:browser` | 73/73 passed in Chromium           | Local app with simulated services: both link forms through email confirmation, expired-link recovery, insurance upload/edit/reload/refused save and existing workflows |
| `npm run build`        | Passed                             | TypeScript and production frontend build                                                                                                                               |
| Functions packaging    | Four packaged/imported for Node 22 | POST endpoints reject GET with 405; scheduled digest imported, not invoked                                                                                             |
| `npm run db:check`     | Passed                             | Installer and upgrade match canonical SQL; SQL was unchanged                                                                                                           |

The six database security/upgrade scenarios passed earlier on 13 November. They were not rerun for this release because it changes no SQL. No real email, model request or scheduled digest was triggered during local verification.

## Deployment and live retest

Publish this revision to GitHub `main` to use the existing Netlify production pipeline, which the supplied retest confirms published the previous revision. Confirm the new production deploy's commit before testing; a Git push alone is not proof of successful publication.

After publication:

1. Complete a full profile with the Riverbend Word/Excel sources and the TXT/PDF control. Then test grant import, grounded search and an application draft with actual questions/word limits. Check output against the originals, not just HTTP success.
2. If a call fails, inspect its **new** support reference in Netlify logs. A confirmed `429` / `RESOURCE_EXHAUSTED` requires checking the Gemini project's model-specific quota, rate and billing dashboard; portal usage of five out of sixty does not establish provider capacity. Other provider status/codes now distinguish validation, key/access, unavailable-model and transient service failures. Historical `OTHER/OTHER` logs cannot be repaired retrospectively.
3. Open a legacy `/?view=opportunities&org=…&opportunity=…` link while signed out, request a fresh email and confirm that the exact grant opens after sign-in. Check an expired link's Back to sign-in destination as well.
4. Record the actual expiry of the synthetic insurance certificate in the document library. Confirm missing/expired dates block the Creekside application and a current date clears that gate. Existing profile/guideline/question/project checks still apply.

Two-account hosted isolation, isolated digest delivery and the optional inbound-email round trip remain unverified live checks from the report. Keep email intake disabled until DNS/MX, receiving/webhook routing and a controlled delivery pass. The report's cleanup suggestions are evidence, not authority to delete records; no test organisations, documents or shared service settings were changed.

This executor has no configured production credentials or Netlify plug-in. Its public-site HTTP probe returned proxy **CONNECT 403**, and Chromium returned **ERR_TUNNEL_CONNECTION_FAILED**, before an application response. GitHub access works, but direct Netlify publication status and real provider behaviour cannot be certified from here.
