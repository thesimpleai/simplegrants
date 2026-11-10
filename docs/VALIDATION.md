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

## Shared-project isolation update

Simple Grant now targets the dedicated `simple_grant` schema and private `simple-grant-documents` bucket. `supabase/install-simple-grant.sql` combines the four canonical migrations into one transaction for the SQL Editor without modifying an existing shared project's CLI migration history. It does not alter unrelated public tables or automatically move legacy Simple Grant data. Deployment requires appending the custom exposed schema and adding the application's Auth redirect while preserving the existing global Auth settings and redirect list.

Validated the shared-project update locally on 10 November 2026:

- `npm test`: **29 tests passed across five files**. The three new transport cases exercise the real Supabase SDK with mocked HTTP, proving schema headers and dedicated-bucket routes for browser, authenticated server and service clients, with no `public` fallback or live network requests.
- `npm run build`: TypeScript and the production build passed.
- `npm run test:browser`: all **six** existing Chromium workflows passed after the namespace change.
- `npm run db:check`: the combined installer exactly matches its canonical migration sources.
- `npm run test:db`: the exact combined installer passed on isolated PostgreSQL 17 with a representative existing-app fixture. Unrelated catalog/config fingerprints, public document/history sentinel records, default privileges, and legacy storage behaviour stayed unchanged. Anonymous, authenticated and custom-role attempts to bypass the new bucket boundaries failed. Inherited custom grants to the new namespace, tables and privileged RPCs were removed. Public-bucket conflicts rolled the entire installer back, and reinstalling an existing namespace failed safely.

The database harness uses minimal Auth/Storage stubs, not a hosted Supabase deployment. Unknown hosted Storage policy definitions still require inspection and an actual project upload/download check; local tests cannot prove compatibility with every existing restrictive policy.

No hosted installer or project settings have been applied by these local checks. The live project has not been linked or verified, and no live credentials have been tested.

## Not yet validated

At initial validation there were no configured Supabase, Gemini or Resend projects/keys. The later shared-project preflight does not establish that the installer, API exposure or Auth redirect has been applied. Hosted authentication/Storage, model availability and real source grounding, actual webhook delivery/DNS, production function timing and scheduled email delivery remain untested. The PostgreSQL test harness has minimal test-only Auth/Storage stubs; it is not a substitute for hosted integration testing.

Official Australian government research pages were blocked by the cloud network policy. The research document marks its primary-source links and current-law verification status accordingly. Do not treat its background thresholds as a live legal determination.

Use the staging checklist in `DEPLOYMENT.md` before inviting real users. This validation does not establish public-launch readiness.
