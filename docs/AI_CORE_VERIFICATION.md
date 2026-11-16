# AI core runtime verification — 16 November 2026

The generic `SG_AI_RESPONSE` failure in the supplied screenshots is reproducible without calling Gemini. Revision `691dac2` exported `executeAI` directly as the Netlify handler. Its second argument is an optional `AIRequestBudget`, but Netlify invokes v2 handlers with `(Request, Context)`. The Context was treated as a budget, causing `budget.read`/`budget.close` failures before the provider call. An uncaught runtime error replaced the handler's JSON response.

The fix keeps the public handler separate: `(request: Request) => executeAI(request)`. Only the background worker explicitly passes its execution budget. No schema, model, key or database change is involved.

## Reproduction and checks

- Four new public-handler regressions failed on the old code with `TypeError: budget.close is not a function`, including profile/search requests and malformed input. They pass after the fix.
- The previously packaged Netlify `ai.zip` also reproduced that TypeError when invoked through its actual `___netlify-entry-point.mjs` and Netlify bootstrap, with the AWS response-stream interface supplied by the runner.
- The new `npm run test:ai:runtime` packages the functions with Netlify's own pinned packaging tool, builds the actual Vite UI, starts Chromium and uses the real Netlify bootstrap, Supabase client, Gemini SDK, document conversion and app transport. Auth/PostgREST/Storage and Gemini are isolated HTTP fixtures. No app handler, source module or browser AI endpoint is mocked.
- In that suite, the profile uses TXT, PDF, DOCX and public-history XLSX originals. Verification receives an actual 31-second delayed HTTP response and completes; all three profile stages reached human review in about 37 seconds. The profile is not automatically saved/approved.
- Draft preflight and generation use the approved organisation facts and selected originals, including a budget spreadsheet with a cached total, missing formula cache and formula error. The generated fixture draft persists and its answer satisfies the real test question's 80-word limit. These assertions verify conversion, transport and persistence; controlled provider output does not establish live model reasoning quality.
- Search and signed extraction save a canonical public source URL. Seven successful model phases consume seven fixture quota claims; polling consumes none.
- Controlled provider HTTP 400 and 504 failures pass through the real SDK and background/result transport, showing `SG_AI_PROVIDER` and `SG_AI_TIMEOUT` with support references rather than an unreadable response. A corrupt DOCX returns 422 before any additional model/quota claim.
- All 271 unit tests, 78 existing browser workflows and the production build pass. Netlify's build command now runs the unit suite before building. The full packaged-runtime suite is also part of GitHub CI.

The packaging tool is a pinned development dependency, not a browser or function runtime import. The application dependency versions are unchanged.

## Real-provider verification prerequisite

`npm run test:ai:live` runs the same built browser/runtime flow using seven live Gemini phases and fictional evidence. Auth/database/storage remain local fixtures, so it does not read or edit production organisations or the production daily quota. Actual model attempts can include the existing bounded retry for transient failures and incur the provider's normal charges. The two error-injection cases remain local controlled HTTP responses. In a proxied environment, the runner uses the inherited proxy/CA settings and requires Node 24.5+.

This environment has no `GEMINI_API_KEY` binding and its enforced network policy blocks `simplegrants.com.au` and Google's AI endpoints. A settings update was attempted but returned `draft_not_editable`; no draft/runtime change was applied. The tool's subsequent read returned the same draft revision. A separate environment setup session must add the network grants and secure key binding, and the running environment must receive them before the agent can execute real-provider checks. Never paste a key into chat or a repository.

The confirmed runtime defect is fixed and covered by the packaged application tests. Live Gemini behaviour and the production deployment cannot be claimed verified from these controlled checks. The remaining action is to enable access for the agent, rather than ask the user to repeat manual QA.
