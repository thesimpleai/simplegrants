# Implementation validation

The original implementation was validated in the development environment on 10 November 2026 before the initial GitHub commit. The results below describe that run, not hosted deployment or the subsequent shared-project isolation update.

- `npm ci` succeeded using the committed lockfile.
- `npm test`: 26 tests passed across four files. These cover unauthenticated/unauthorised API rejection, viewer mutation denial, guideline/question/project gates, exact-source requirement preflight, optional versus mandatory audits, three-pass profile source boundaries, deadline dates/timezones, public-only email content and readable draft output. Provider and API flow tests use mocks; no real email was sent.
- `npm run build`: TypeScript validation and Vite production build passed.
- `npm run test:browser`: six Chromium workflows passed: search/application gates, organisation isolation, expenses/milestones, award-to-project conversion, inbox/demo integration boundaries and mobile navigation/overflow.
- `npm run test:db`: all four migrations and SQL security regressions passed on disposable PostgreSQL 17. This includes tenant relationships, storage paths, viewer permissions, ownership, anti-escalation, quotas and idempotent job claims.
- The production frontend bundle rendered on desktop and mobile with no page errors and no horizontal mobile overflow. Screenshots are in `screenshots/`.
- All three Netlify Function entry points bundled successfully for Node 22 using esbuild. This checks packaging, not deployed Netlify execution.
- Additional focused browser checks verified modal keyboard trapping, Escape, focus restoration and scroll restoration; project-plan budget validation/co-funding acknowledgement; milestone completion retention; and invoice evidence selection.

During the clean-install rerun, the old development server retained an obsolete Vite dependency cache. Its requests returned `504 Outdated Optimize Dep`. Restarting that server after installation fixed it; the complete browser suite then passed with a fresh test-managed server. No assertions were disabled.

## Shared-project isolation update (historical run)

This run moved Simple Grant into the dedicated `simple_grant` schema and private `simple-grant-documents` bucket. At that stage the combined SQL Editor installer contained four migrations and login used the native shared Auth email flow. The tests below concern that version. The current app-specific login adds migration 005 and its own token-confirmation callback; its deployment does not require changing the shared project's global Auth settings or redirects.

Validated the shared-project update locally on 10 November 2026:

- `npm test`: **29 tests passed across five files**. The three new transport cases exercise the real Supabase SDK with mocked HTTP, proving schema headers and dedicated-bucket routes for browser, authenticated server and service clients, with no `public` fallback or live network requests.
- `npm run build`: TypeScript and the production build passed.
- `npm run test:browser`: all **six** existing Chromium workflows passed after the namespace change.
- `npm run db:check`: the combined installer exactly matches its canonical migration sources.
- `npm run test:db`: the exact combined installer passed on isolated PostgreSQL 17 with a representative existing-app fixture. Unrelated catalog/config fingerprints, public document/history sentinel records, default privileges, and legacy storage behaviour stayed unchanged. Anonymous, authenticated and custom-role attempts to bypass the new bucket boundaries failed. Inherited custom grants to the new namespace, tables and privileged RPCs were removed. Public-bucket conflicts rolled the entire installer back, and reinstalling an existing namespace failed safely.

The database harness uses minimal Auth/Storage stubs, not a hosted Supabase deployment. On 10 November 2026 the supplied three existing Storage policy definitions were reproduced exactly in a second pristine-container regression: authenticated `pdfs` SELECT/INSERT with `auth.role()` checking, and the restrictive `finance-evidence` guard for anon/authenticated. Both this exact-policy case and the original adversarial broad-policy case passed the full installer/security run. Existing PDF SELECT/INSERT stayed allowed, PDF UPDATE/DELETE stayed denied, finance restrictions and service-role bypass stayed intact, and Simple Grant membership-based storage CRUD worked. No production policy or installer change was needed. The test-only `auth.role()` stub uses JWT claims, rather than treating a SQL role switch as proof of authentication.

An actual project sign-in and Storage API upload/download check is still required after installation. Local tests do not establish hosted integration readiness or cover future policy changes.

No hosted installer or project settings have been applied by these local checks. The live project has not been linked or verified, and no live credentials have been tested.

## App-specific Resend login with CAPTCHA (historical, before simplification)

This earlier staged login flow kept shared Supabase identities while sending a Simple Grants email through a server-only Resend route. It adds a dedicated `/auth/confirm` return page, hostname/action-checked Turnstile, durable HMAC email/IP quotas, generic account acknowledgements and app/project-specific browser storage with local-only logout. The callback clears the token fragment before the user explicitly confirms sign-in. Native URL session detection is disabled, so legacy implicit/PKCE links require a fresh application-specific email after rollout. There is no fallback to the shared project's email templates when security/provider configuration is absent.

Existing 001–004 installations use only `202611100005_auth_email.sql`; fresh installations use the five-migration combined installer. No global SMTP, Site URL, email-template, signup-setting or unrelated-redirect change is part of this update. `AUTH_ALLOW_SIGNUPS=false` restricts delivery to existing shared accounts unless onboarding is explicitly enabled.

This historical version required six new settings and Turnstile. Those requirements and the results below precede the current simplification; they do not validate the revised flow. Default preview origins are deliberately rejected by the canonical-origin check. Validated locally on 11 November 2026:

- `npm test`: **77 tests passed across eight files**, including branded-email request guards, generic account acknowledgements, fixed application-origin links, provider failure handling, auth-session isolation and same-origin return paths. Provider calls are mocked; no real email was sent.
- `npm run build`: TypeScript and the production build passed.
- `npm run test:browser`: **17 Chromium workflows passed**, including explicit confirmation before token use, fragment removal, rejection of external returns, missing/expired CAPTCHA, the real SDK ignoring unsolicited implicit/PKCE callbacks, and the app login request preserving a grant deep link without calling Supabase’s shared OTP mailer.
- The database test suite passed fresh adversarial and exact-policy fixtures, plus an existing 001–004 installation upgraded with **005 only**, preserving its existing organisation. Service-only ACLs, sequential quotas, bounded cleanup and real concurrency were exercised: one of twelve simultaneous same-email requests and twenty of twenty-five same-IP requests claimed a slot.
- The generated five-migration installer matches its canonical sources. Existing shared metadata, legacy file rules and migration history stayed unchanged in the isolated SQL tests.

These are local code/database checks, not hosted provider delivery or account-setting verification. A mocked email/API test is not proof that the sending domain is verified or that a real login email/callback works. No real login email has been sent by these local checks.

## Simplified app-specific login (before comprehensive source review)

This version uses only the existing Supabase, Resend and Netlify services, with four new server settings. It removes the CAPTCHA dependency while retaining mandatory migration 005, HMAC email/IP quotas, exact canonical-Origin checks, Netlify-provided request IP, an optional honeypot, generic acknowledgements, app-local logout and explicit confirmation of the private token fragment. Other applications' global Auth settings remain unchanged.

The SQL limits are unchanged: sixty-second email cooldown, five claimed requests per email per hour and twenty per IP per hour. Automated clients can spoof Origin, omit the honeypot and distribute requests across IPs. Existing-user-only delivery is the default; enabling public signups increases abuse exposure. These controls do not establish comprehensive bot prevention.

This run assumed migration 005, the four login settings and Resend sender verification/DNS as deployment prerequisites. The previous **77 unit / 17 browser** results describe the superseded CAPTCHA version. The simplified version was validated locally on 11 November 2026:

- `npm test`: **78 tests passed across eight files**, including plain email-only requests with no CAPTCHA environment settings or external verification calls, honeypot suppression, mandatory quota failure handling, token/session boundaries and provider-error acknowledgements.
- `npm run build`: TypeScript and the production frontend build passed.
- `npm run test:browser`: **17 workflows passed**, including immediate email-form use, duplicate submission prevention, failed-request retry, hidden-field propagation, no Cloudflare assets or native Supabase OTP requests, explicit confirmation and unsolicited URL-token rejection.
- `npm run db:check`: the generated installer still matches its canonical sources. Migration 005 and its previously tested SQL rate limits/concurrency logic did not change in this simplification. No real login email or provider/account settings have been changed by these local checks.

## Comprehensive check (current, 11 November 2026)

The user reports that the auth prerequisites are complete. The production branch is `main`; a GitHub revision is not proof that Netlify has deployed it. No account configuration, hosted migration, real sign-in email or production application behaviour has been independently verified by this check.

The review identified four defects, with local regression coverage:

- Workspace database failures now show a persistent error and retry action, instead of appearing as an empty organisation or data set.
- Report prompts use an explicit whitelist of project evidence and the recorded expense ledger. A saved AI report is excluded from the next report's source context.
- Grant rediscovery refreshes public metadata while preserving existing round dates and history. Clearly later rounds get separate records; uncertain date changes get review flags and a visible badge/notice. Expired or archived saved rounds are excluded from current search/digest results.
- On a 720px-high desktop viewport, the signed-in sidebar could leave Sign out below the reachable area. Sidebar scrolling/sizing fixes passed the full browser suite with real clicks at the unchanged viewport, including Overview, Settings and Sign out.

The first three findings came from source inspection; the sidebar problem was reproduced in a local browser trace. None was observed on the production site. Final local results:

- `npm test`: **86 of 86 tests passed across nine files**, including report-context, discovery-round and same-Melbourne-calendar-day boundary regressions.
- `npm run build`: TypeScript and the production Vite build passed after the final sidebar CSS fix.
- `npm run test:db`: all **three pristine database scenarios** passed, including the 005-only upgrade preserving existing data and quota concurrency checks. `npm run db:check` confirmed that the combined installer matches the canonical migration sources. The harness uses test-only Auth/Storage stubs, not a hosted Supabase deployment.
- All **four** Netlify Functions packaged for Node 22 with esbuild. Local GET probes returned **405** for the three POST-only API endpoints. The scheduled digest module was imported only; its handler was not invoked and no real email was sent.
- `npm run test:browser`: **22 of 22 Chromium workflows passed** in 12.5 seconds: the original 17 plus five error/recovery cases. Real navigation and Sign out clicks passed at the unchanged 720px-high desktop viewport; no forced click or assertion relaxation was used.

`npm audit --omit=dev --json` also reported **0 vulnerabilities across 63 production dependencies**. This reflects the npm registry advisories available at check time; it does not verify application logic or hosted configuration. No dependency upgrades were required.

Live HTTP requests were blocked at the task's proxy with **CONNECT 403**; browser navigation failed with **ERR_TUNNEL_CONNECTION_FAILED**. The running environment reported an enforced network policy with an empty custom `allowed_hosts` list, while the saved configuration draft contained the required application destinations. A current status recheck still reported enforced restricted policy at spec/observed revision 1, with the required application domains absent from the effective allowlist. A saved draft does not establish that its policy is active. These transport failures occurred before an application response and do not establish that the website is down or its account setup is wrong.

The current release uses only Supabase, Resend and Netlify for login, with four server auth settings and no additional provider. The SQL 005 limits and shared-Auth boundaries remain as documented in `AUTHENTICATION.md`. Hosted checks remain blocked until task connectivity is restored. The completed setup should not be repeated merely because this executor could not reach the site.

## Login failure diagnostics update (11 November 2026)

A reported hosted sign-in failure displayed the existing generic unavailable message. This identifies a pre-delivery server failure, but its hosted cause has not been established. The update adds safe diagnostic references for setup, schema, RPC, access and database failures. Logs retain only fixed stages, allowlisted error categories and random references; account-dependent outcomes still return identical acknowledgements. The browser requires HTTP 202 JSON with `accepted: true`, preventing an HTML fallback from appearing to send an email.

- `npm test`: **100 of 100 tests passed across nine files**, including privacy canaries, thrown/malformed database responses and unchanged account/provider acknowledgements.
- `npm run build`: TypeScript and the production build passed.
- The focused email sign-in browser suite passed **12 of 12 cases**, including safe references, invalid/HTML responses and network retry. The other browser workflows were not rerun for this update; their earlier 22-case result belongs to the comprehensive check above.
- The auth Function bundled for Node 22; its packaged GET guard and missing-configuration diagnostic passed without provider calls.
- The read-only SQL diagnostic passed **nine disposable PostgreSQL scenarios**, covering missing and installed objects, incorrect permissions/RLS and inconclusive API exposure. It does not execute login RPCs or read user records.

These results validate the diagnostic changes, not a repair to the hosted configuration. Production verification awaits the actual SQL result or a safe deployed error reference; no provider credentials or live email were used.

## Profile preparation and document formats (11 November 2026)

The reported error occurred after **Prepare my profile**, rather than during file upload. Its old text came from a non-JSON failed AI response. The hosted failure was not directly inspected, but the source had a timeout risk: three sequential model calls could take 54 seconds before other work, while the installed Netlify SDK documents a 30-second synchronous default.

Profile extraction, verification and correction now use three separately authenticated requests, each with a 27-second request budget and at most one 18-second model call. Each stage checks quota, reloads selected originals and checks their identity; the fingerprint covers organisation, original text, ordered evidence and downloaded file-byte hashes. Only correction returns an approvable profile. Users see progress and retain their stored documents and inputs after a failure. Each stage counts as one daily AI request.

The shared document policy now supports DOCX/XLSX and additional text formats alongside the existing PDF/images/text. Office originals stay private; bounded text/table extraction is sent to Gemini rather than unsupported Office MIME data. Spreadsheet formulas are not recalculated; missing cached values and saved errors are labelled. Oversized or unsafe documents are rejected without truncation. Non-PDF/image files download as attachments. Migration 006 changes only the dedicated bucket's MIME allowlist.

- `npm test`: **137 of 137 tests passed across twelve files**, including stage contracts, raw-source changes, deadlines, provider-error privacy, Office parsing and upload-format policy.
- `npm run test:browser`: **43 of 43 workflows passed**, including thirteen profile/document cases plus existing sign-in, portal and connection recovery checks.
- `npm run build`: TypeScript and the production Vite build passed. `npm run db:check` confirmed that the six-baseline installer matches its sources.
- `npm run test:db`: **four scenarios passed**, covering fresh six-baseline installs, exact existing policy definitions, prior auth upgrade and standalone 005-to-006 upgrade. Existing records, private access, unrelated metadata and PDF/finance permissions were preserved. The repeat 006 upgrade was a no-op and invalid bucket settings failed safely.
- All four Functions bundled as CommonJS and loaded on **Node 22.23.4**. Three POST-only endpoints returned 405 for GET; the scheduled digest handler was imported but never invoked. The packaged converter extracted real generated DOCX and XLSX evidence on that runtime.
- `npm audit --omit=dev`: **zero reported vulnerabilities across 94 production dependencies** at check time. Independent parser, tenant-isolation and privacy review found no remaining concrete blocker.

These are local tests with mocked model/provider calls and disposable PostgreSQL. Migration 006 has been prepared for the existing hosted project but was not applied from this executor. Netlify's deployed revision, real Gemini responses and hosted Office uploads remain unverified; the running task's network policy still blocks those application destinations.

## Live-QA remediation (11 November 2026)

The user supplied a live QA report for deployed revision `6a25e88`. It observed working branded authentication, one complete three-stage profile with source contradictions, record persistence, manual grant/project tracking and anonymous-access denial. It also observed the original five-type bucket allowlist, intermittent AI failures around the 18-second model window, two model-response validation failures, and a failed receiving-domain delivery. Those are supplied live observations of that baseline, not results from this executor. Missing shared CLI migration-history entries alone do not establish SQL Editor migration state; the actual bucket allowlist establishes that expanded upload types were unavailable.

The remediation separates remaining hosted configuration from code changes:

- Existing installations use the atomic, repeatable `supabase/upgrade-qa.sql` (unchanged 006 plus new 007). It enables expanded MIME types and changes only the default for future organisation types to unknown. Existing organisation values and evidence remain intact. Applying this hosted upgrade is still required.
- Discovery and application drafting now have two authenticated, quota-counted phases, each making at most one model request. Signed 15-minute continuation receipts bind the user, organisation, intermediate state and current original evidence. Profile preparation remains three requests. The model window is up to 25 seconds within the 27-second request budget; model JSON schemas, nullable optional fact handling and fixed private failure reasons address the observed latency/output failure classes. This is a tested mitigation, not proof of live reliability.
- Explicit mandatory insurance in original guidelines blocks drafting before model access; optional, negated and unresolved conditional clauses are not made universal requirements. Final draft writes use an optimistic application version/status guard, preserving concurrent manual edits or submissions.
- Uploads report named saved/failed/skipped files and continue after individual storage failures. Possible duplicates are skipped using name, byte length and normalised MIME, with the heuristic stated; this is not server-side content-hash deduplication.
- Source badges distinguish imports, added links and grounded citations. Grant selections are in the URL and retained through sign-in. Organisation selection is persisted per user/project, search state resets on change, menus dismiss correctly, and unknown types remain unknown. Manual submission requires explicit acknowledgement plus a reference or a no-reference acknowledgement.
- Inbox addresses are hidden unless a strict build flag and valid configured hostname are supplied. The flag is administrator confirmation, not DNS verification. Receiving DNS/MX, webhook processing and a controlled delivery test still need external configuration before enabling the address.

Final local checks for this remediation:

- `npm test`: **186 of 186 tests passed across fourteen files**.
- `npm run test:browser`: **68 of 68 workflows passed** in 37.5 seconds, including the new staged grant, inbox-readiness and upload/workspace regressions.
- `npm run build` passed TypeScript and the production Vite build. `npm run db:check` verified both the seven-baseline installer and targeted QA upgrade against their sources.
- `npm run test:db`: **six scenarios passed**, including fresh seven-baseline installs, exact supplied storage rules, prior upgrade paths, 005-to-006/007 and an already-006 installation. Atomic rollback, repeatability, existing types/evidence and shared-project permissions were verified.
- All four Function bundles loaded on **Node 22.23.4**. Three GET guards returned 405, the packaged Office converter read genuine generated DOCX/XLSX fixtures, and the digest handler was imported without invocation. No provider or outgoing email calls were made.
- Independent review found no remaining concrete blocker in the changed source, including receipt forgery boundaries, private diagnostics and concurrent draft protection.

## Remaining live verification

The supplied QA establishes several working hosted flows on `6a25e88`, as described above. The current remediation has local validation only. Its Netlify deployment, hosted 006/007 upgrade, Office upload/AI reading, improved real Gemini completion rate and receiving-domain repair have not been verified by this executor. Cross-account isolation, controlled digest delivery and the previously blocked browser cases still require their stated accounts/tools. The PostgreSQL test harness has minimal test-only Auth/Storage stubs; local model calls use mocks and do not substitute for those live tests.

Official Australian government research pages were blocked by the cloud network policy. The research document marks its primary-source links and current-law verification status accordingly. Do not treat its background thresholds as a live legal determination.

Use the staging checklist in `DEPLOYMENT.md` before inviting real users. This validation does not establish public-launch readiness.
