# Initial implementation validation

Validated in the development environment on 10 November 2026, before the initial GitHub commit.

- `npm ci` succeeded using the committed lockfile.
- `npm test`: 26 tests passed across four files. These cover unauthenticated/unauthorised API rejection, viewer mutation denial, guideline/question/project gates, exact-source requirement preflight, optional versus mandatory audits, three-pass profile source boundaries, deadline dates/timezones, public-only email content and readable draft output. Provider and API flow tests use mocks; no real email was sent.
- `npm run build`: TypeScript validation and Vite production build passed.
- `npm run test:browser`: six Chromium workflows passed: search/application gates, organisation isolation, expenses/milestones, award-to-project conversion, inbox/demo integration boundaries and mobile navigation/overflow.
- `npm run test:db`: all four migrations and SQL security regressions passed on disposable PostgreSQL 17. This includes tenant relationships, storage paths, viewer permissions, ownership, anti-escalation, quotas and idempotent job claims. A pre-existing public documents bucket is rejected without altering it or leaving application tables behind.
- The production frontend bundle rendered on desktop and mobile with no page errors and no horizontal mobile overflow. Screenshots are in `screenshots/`.
- All three Netlify Function entry points bundled successfully for Node 22 using esbuild. This checks packaging, not deployed Netlify execution.
- Additional focused browser checks verified modal keyboard trapping, Escape, focus restoration and scroll restoration; project-plan budget validation/co-funding acknowledgement; milestone completion retention; and invoice evidence selection.

During the clean-install rerun, the old development server retained an obsolete Vite dependency cache. Its requests returned `504 Outdated Optimize Dep`. Restarting that server after installation fixed it; the complete browser suite then passed with a fresh test-managed server. No assertions were disabled.

## Not yet validated

There were no configured Supabase, Gemini or Resend projects/keys. Hosted authentication/Storage, model availability and real source grounding, actual webhook delivery/DNS, production function timing and scheduled email delivery remain untested. The PostgreSQL test harness has minimal test-only Auth/Storage stubs; it is not a substitute for hosted integration testing.

Official Australian government research pages were blocked by the cloud network policy. The research document marks its primary-source links and current-law verification status accordingly. Do not treat its background thresholds as a live legal determination.

Use the staging checklist in `DEPLOYMENT.md` before inviting real users. This validation does not establish public-launch readiness.
