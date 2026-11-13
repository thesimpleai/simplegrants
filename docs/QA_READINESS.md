# QA readiness review — 13 November 2026

**Not yet cleared for real-user launch.** The attached 11 November report includes a retest of the checked-out revision, `0432b42`: uploads and most UI fixes had passed, but five of six AI calls failed. This update adds tested reliability mitigations and fixes expired sign-in link recovery. It has not been deployed or tested against real providers from this workspace.

## Changes in this update

- Retry temporary provider/network failures once within the existing 27-second request deadline, with a 250 ms delay and at least eight seconds remaining. Do not retry timeouts, quota/auth/model-access errors or invalid output. Application writes and portal quota claims are not repeated by that retry.
- Increase profile extraction/checking output ceilings from 2,048 to 4,096 tokens and correction from 3,072 to 6,144. Request concise descriptions and short representative quotes while still supplying the complete original sources and retaining unresolved checks. Incomplete or invalid model output remains a failure, never an approvable profile.
- Apply known concrete models' thinking controls to grounded search as well as structured generation. Keep the configured model/default alias: switching to an unverified or retired model would introduce a new launch risk. Availability and latency must be tested with the production key.
- Recognise wrapped provider status and network errors. Log fixed categories such as `NETWORK` and numeric provider status instead of the undifferentiated `OTHER`, without exposing SDK messages, credentials or document contents.
- Preserve the organisation and grant destination when an expired/used email link sends the user back to request a fresh link.

No database migration or dependency upgrade is required by these code changes. Provider retries and higher token ceilings can increase Gemini usage/cost.

## Local verification

| Check                     | Result                            | Scope                                                                                                                              |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                | 199/199 passed across 14 files    | Mocked provider/API tests, extraction from actual generated Office archives, privacy, source checks, deadlines and mutation guards |
| `npm run test:browser`    | 69/69 passed in Chromium          | Local app; connected-service responses are simulated, including sign-in, profile/search/draft flows and recovery                   |
| `npm run test:db`         | All six scenarios passed          | Disposable PostgreSQL 17; tenant/storage isolation, exact existing policy compatibility and upgrades through 007                   |
| `npm run db:check`        | Passed                            | Installer/upgrade bundles match canonical migrations                                                                               |
| `npm run build`           | Passed                            | TypeScript and production frontend build                                                                                           |
| Functions packaging       | Four bundled/imported for Node 22 | POST endpoints reject GET with 405; scheduled digest imported, not invoked                                                         |
| Production frontend smoke | Passed                            | Desktop 1440×900 and mobile 390×844; no page errors or horizontal overflow, demo data only                                         |

New regressions exercise quick transient failures, refusal to retry permanent/late failures, a single successful draft write after retry, and a complete simulated email-confirmation round trip to a grant in the second organisation. The full browser run also caught an ambiguous existing selector during account-change loading; the test now targets the header action and waits for records before checking recovery. The original account-change guard passed, with no second AI phase issued.

## Report findings and remaining scope

| Finding                  | Assessment                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 upload formats        | The supplied retest says production uploads passed after the existing upgrade. Local parser tests cover renamed/corrupt Office files, cached/missing/error formula values, sheet/cell/size limits and HTML/XML as text. Real provider use of those converted sources still needs retesting. |
| D2 AI reliability        | Mitigated in code, **not verified fixed in production**. Timeout tuning alone had already failed the supplied retest. Real provider responses and deployed logs are required to establish the remaining cause and actual completion rate.                                                   |
| D3 email intake          | Remains an optional disabled feature until receiving DNS/MX, Resend routing and a signed webhook round trip pass. Existing inbox records and portal uploads remain usable. The enable flag is administrator confirmation, not a health check.                                               |
| D4–D8                    | Existing fixes retained and covered locally: insurance gating, unknown organisation type, visible duplicate/batch results and honest source badges.                                                                                                                                         |
| D9 / sign-in destination | Existing URL selection, remembered organisation, search reset and menu behaviour pass locally. Grant ID survives a complete simulated sign-in and reload; expired-link recovery now preserves it too. A real email-link round trip remains unverified.                                      |
| Submission confirmation  | Already guarded in this revision, including reference or explicit no-reference acknowledgement. Manual externally prepared applications remain supported.                                                                                                                                   |
| Cross-account isolation  | Local SQL and stale-identity browser regressions pass; a two-account hosted Auth/REST/Storage check is still required.                                                                                                                                                                      |
| Digests                  | Real delivery, recipient isolation and deduplication still require an isolated test recipient. No real email or scheduled job was triggered here.                                                                                                                                           |

The report is treated as evidence, not authority to delete test organisations, modify shared authentication or change DNS. No test records or live settings were changed.

## Live checks before launch

1. Deploy this revision and confirm its actual Netlify production revision. Preserve existing shared Supabase settings; the supplied retest says upgrades 006/007 were already applied, so verify their state rather than reinstalling baselines.
2. With an authorised test account and a verified available model, complete repeated full profile, grant import/search and application-draft flows. Include bilingual DOCX/XLSX evidence, actual question/word limits and a required-insurance case. Check source fidelity and missing facts, not just HTTP success. Resolve any remaining provider errors using their safe references; local mocks do not establish production reliability.
3. Request a fresh branded sign-in email from a grant deep link in a non-default organisation. Confirm explicit sign-in opens that exact grant; a used/expired link must offer a fresh request with the destination retained.
4. Use two separate hosted accounts to verify cross-organisation REST, Storage and signed-URL denial. Test digest delivery only to a controlled recipient and check repeat-run deduplication before enabling real notifications.
5. For a portal-only pilot, keep email forwarding disabled. To offer email intake, first complete the receiving checks in [Deployment](DEPLOYMENT.md).

This executor has no configured production service credentials. A public HTTP probe returned proxy **CONNECT 403**, and Chromium navigation returned **ERR_TUNNEL_CONNECTION_FAILED**, before an application response. This prevents hosted verification; it does not show that the site itself is down. Production readiness remains open until these live checks pass.
