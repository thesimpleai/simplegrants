# Deploy Simple Grant

Simple Grant has a React portal, Netlify Functions, Supabase Auth/Postgres/private Storage, Gemini for assisted work, and Resend for receiving and sending email. Netlify hosts the application; it does not replace the Supabase database or the email DNS configuration.

The demonstration mode works without service keys and contains fictional records. It is for evaluating the interface. Live authentication, organisation data, AI calls, receiving email and scheduled summaries require the services below. Never use demonstration records as real funding opportunities.

## 1. Connect Supabase without changing other applications

Simple Grant can use an existing Supabase project shared with other applications. Its tables and RPCs live in the dedicated `simple_grant` schema, and its private Storage bucket is `simple-grant-documents`. These names are fixed in the application; no extra schema or bucket environment variables are needed. Existing `public` tables and other applications' migration history must remain untouched.

1. Open the intended Supabase project and record its **Project URL** and public anon/publishable key. Use this same project's URL and public key in both corresponding browser and server settings below. Obtain the privileged service role/secret key for Functions only. The service key is privileged across the **entire shared project**, even though this application's code targets its own schema; never put it in the browser or chat.
2. Review **`supabase/install-simple-grant.sql`**. For a fresh installation, this is the combined installer for the seven baseline migrations, wrapped in **one transaction**. In that project's **SQL Editor**, paste and run the complete installer once. It creates Simple Grant's schema, tenant policies, private bucket, shared portal/email AI quota and saved report-draft field. No seed data is required. Run the complete file; do not apply fragments after an error. Existing installations through 005 or 006 use `supabase/upgrade-qa.sql`, which applies unchanged 006 plus the additive 007 in one idempotent transaction. It extends the dedicated document MIME list and sets only future organisation types to unknown; existing values remain intact. If the installation stops at 004, apply 005 before the QA upgrade. Never repeat installed baselines or rerun the initial installer over an existing installation.
3. In **Settings → Data API / API → Exposed schemas**, **append `simple_grant`** to the existing list and save. Preserve every existing exposed schema. This step makes the new schema available through Supabase's REST API; creating tables alone does not expose it. If the API schema cache needs refreshing, the safe SQL notification is:

   ```sql
   notify pgrst, 'reload schema';
   ```

   Do not replace the exposed-schema list or alter unrelated PostgREST configuration.

4. Configure the **application-specific Resend login** in [Authentication](AUTHENTICATION.md): verify `simplegrants.com.au` in Resend with click tracking disabled for login links and add the four login environment variables. No additional provider account is needed. The application-owned `/auth/confirm` page verifies the generated token directly; this flow does not require changing Supabase's project-wide redirect settings.
5. **Keep the shared project's existing Auth Site URL, SMTP, templates, signup settings and all other applications' redirects unchanged.** The separate database schema does not separate the Auth user pool. Simple Grants supplies its own login email, callback and browser session storage while continuing to use shared Supabase Auth identities.
6. Enter the environment variables in Netlify, deploy the updated application, then test branded sign-in, organisation creation, private upload/download and cross-account isolation. Existing Simple Grant users need a fresh sign-in after the session-storage change. The configured project is not considered linked or validated merely because its URL and keys were entered.

**For this shared project, do not run `supabase db push`, `supabase db reset` or migration-history `repair` commands.** The SQL Editor installer deliberately avoids modifying the unrelated CLI migration history. The files under `supabase/migrations/` are the canonical source baselines used to build the installer, not an instruction to push this repository's history over another application's history.

The installer does not automatically move any earlier Simple Grant records from `public` or reuse another application's tables/bucket. If you previously installed the original public-schema version, preserve it and arrange a separate, reviewed data migration before switching real users. An existing `simple_grant` schema or `simple-grant-documents` bucket also needs investigation rather than deletion or an improvised reset.

The private bucket supports PDF, JPEG, PNG, WebP, DOCX, XLSX, TXT, CSV, TSV, Markdown, JSON, HTML and XML. Upload at most ten files per batch, each up to 10 MiB. AI requests accept at most eight selected documents totalling 15 MiB. DOCX/XLSX are converted to bounded text on the server; their raw Office MIME types are never sent directly to Gemini. Legacy `.doc`/`.xls` and macro-enabled Office files need conversion to DOCX, XLSX or PDF. See the document conversion notes below. Simple Grant adds access boundaries for its dedicated bucket while preserving existing Storage policies. A shared project's unknown restrictive policies may still block its operations; diagnose the specific failure and never remove or relax another application's policy just to make an upload work.

You do not need to give this assistant account access to complete these steps. Apply the reviewed installer and enter the keys directly in Netlify. If you want the assistant to perform hosted setup later, provide an explicitly authorised, securely authenticated connection scoped to the intended work; do not paste access tokens, database passwords or API secrets in chat. The hosted installer and settings changes remain unapplied until someone with project access performs them.

Row-level security separates organisations within Simple Grant. One login can own several organisations, and the creation RPC atomically adds the initial owner. The first release does not include a self-service team invitation interface. Sharing an Auth project does not automatically grant a user membership of a Simple Grant organisation.

## 2. Connect Netlify to GitHub

1. In Netlify, connect `thesimpleai/simplegrants` and use `main` as the production branch.
2. Use the repository's `netlify.toml`: Node 22, build command `npm run build`, publish directory `dist`, and functions directory `netlify/functions`.
3. Add the environment variables below. Public Vite values must be available during the build. All other API keys must be available to Functions, including scheduled functions. Give preview deploys separate non-production service credentials, or leave their live integrations disabled.
4. Before production rollout, complete [Authentication](AUTHENTICATION.md): working HTTPS on `https://simplegrants.com.au`, the required migrations through 007, the four login settings and verified Resend login sender. Verify these prerequisites for the deployment environment and skip migrations that are already installed. Local tests do not establish provider configuration or real delivery. Default preview origins intentionally cannot exercise the production login route.
5. Deploy the current `main` revision and wait for the Netlify production deployment to complete. A source push alone does not establish the live revision. Changing a `VITE_` variable requires rebuilding the frontend; redeploy after runtime secret changes. Request a fresh application-specific email and test sign-in and a protected grant deep link on the canonical domain. Old native Supabase links are not consumed after rollout. Leave the shared Supabase global Auth configuration unchanged.

### Required environment variables

| Variable                     | Used by        | Value                                                                                    |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`          | Browser/build  | Your Supabase Project URL                                                                |
| `VITE_SUPABASE_ANON_KEY`     | Browser/build  | Your project's public anon/publishable key                                               |
| `SUPABASE_URL`               | Functions      | The same Project URL                                                                     |
| `SUPABASE_ANON_KEY`          | Functions      | The same public anon/publishable key                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`  | Functions only | Project-wide privileged service role/secret key; Functions only                          |
| `GEMINI_API_KEY`             | Functions only | Gemini API key for a project with billing/quota and the required model access            |
| `GEMINI_MODEL`               | Functions      | `gemini-flash-latest` by default; configurable model identifier                          |
| `RESEND_API_KEY`             | Functions only | Resend API key with the required sending and receiving API access                        |
| `RESEND_WEBHOOK_SECRET`      | Functions only | Signing secret of the receiving webhook, not the sending API key                         |
| `EMAIL_AI_REPLIES`           | Functions      | Optional `false` default; enables tightly restricted public-information question replies |
| `EMAIL_AUTO_ACK`             | Functions      | Optional `false` default; fixed public receipt used only when AI replies are disabled    |
| `EMAIL_FROM`                 | Functions      | A verified sender, e.g. `Simple Grant <grants@thesimpleai.com>`                          |
| `INBOUND_EMAIL_DOMAIN`       | Functions      | Actual receiving hostname; must match the frontend domain                                |
| `VITE_INBOUND_EMAIL_DOMAIN`  | Browser/build  | Matching receiving hostname only; blank until configured                                 |
| `VITE_INBOUND_EMAIL_ENABLED` | Browser/build  | `false` default; set `true` only after the receiving/DNS/webhook/test checks below       |
| `AUTH_APP_URL`               | Functions      | Canonical login origin: `https://simplegrants.com.au`                                    |
| `AUTH_EMAIL_FROM`            | Functions      | Verified login sender: `Simple Grants <login@simplegrants.com.au>`                       |
| `AUTH_ALLOW_SIGNUPS`         | Functions      | `false` default; `true` explicitly permits new shared Auth users                         |
| `AUTH_RATE_LIMIT_SECRET`     | Functions only | Separate random HMAC secret; generate at least 32 random bytes                           |
| `URL`                        | Functions      | Netlify supplies the site's canonical URL; used for grant-summary portal links           |

No Gemini key, Resend key or Supabase service role key should have a `VITE_` prefix. Vite bundles variables with that prefix into downloadable browser code.

Create the Gemini key in your Google AI Studio/Google Cloud project and the Resend key in Resend. Enter both into Netlify; the Resend key does not belong in Gemini settings.

The Flash alias can change its underlying model. Before launch, verify that the selected model supports the document formats and Google Search grounding this application uses. Pin `GEMINI_MODEL` to a tested stable Flash model if you need predictable behaviour and cost. Configure quota and budget limits in the provider account. The database also limits portal and eligible public-email AI requests to a shared 60 per user per UTC day across organisations; this is a request count, not a token or dollar cap. Profile preparation uses three separately authenticated requests; discovery and application drafting each use two. Every successfully claimed phase consumes one of the daily requests, including a phase whose downstream work fails. Retry restarts that flow from its first phase with the preserved originals; those requests claim quota again. Scheduled discovery has separate consumption. This setup does not claim that a particular preview model is the latest supported production model.

## 3. Configure email and your domain

Login emails use the separately verified `simplegrants.com.au` domain through `AUTH_EMAIL_FROM`; see [Authentication](AUTHENTICATION.md). Grant summaries/inbound evidence continue to use `EMAIL_FROM` and `INBOUND_EMAIL_DOMAIN`. Do not change existing mail routing to configure login sending.

Receiving setup is separate from login/sending-domain verification. Keep `VITE_INBOUND_EMAIL_ENABLED=false` until an administrator has completed the following checks. The application has no fallback receiving domain.

1. Choose a subdomain you own for receiving. In **Resend Receiving**, enable that domain and publish the **exact MX target and priority Resend supplies** at that subdomain. Do not invent DNS values, replace the apex domain's existing MX records or disturb staff mail. Confirm the receiving hostname resolves and Resend shows receiving enabled; a verified sending domain alone is insufficient.
2. Set the identical hostname, without URL scheme/path/port, in `INBOUND_EMAIL_DOMAIN` (Functions) and `VITE_INBOUND_EMAIL_DOMAIN` (Builds). The Resend API key must allow the receiving API used to fetch message content. Use your verified `EMAIL_FROM` separately for outbound summaries/receipts.
3. Create an `email.received` webhook with the canonical endpoint **`https://simplegrants.com.au/.netlify/functions/inbound-email`**. Use the actual final canonical hostname if it differs. Avoid an old Netlify alias that redirects POSTs. Set its signing secret in `RESEND_WEBHOOK_SECRET` and deploy the function configuration.
4. Before publishing an address to users, send a harmless controlled test from the verified email of a member of a clearly named test organisation. An authorised administrator can read that test organisation's stored `inbox_alias` and combine it with the receiving hostname for this private test. Confirm provider delivery, a valid signed webhook and the message appearing only in that organisation's portal. Do not test with private real invoices or other recipients.
5. Only after that round trip passes, set **`VITE_INBOUND_EMAIL_ENABLED=true`** in the production Builds context and rebuild/redeploy. A hostname must be valid and non-placeholder before the address/copy action is shown. This flag is **administrator confirmation, not automatic DNS verification or a backend health check**. Recheck the visible address after deployment; frontend and server domains must match.

If receiving is not confirmed, keep the flag false. Users see “Email intake is not ready yet” and can upload documents in the portal; existing inbox messages remain reviewable. Receiving failures should be diagnosed without exposing another address or weakening webhook/tenant permissions. This release stores email bodies and **attachment metadata only**; original files still need portal upload. Forwarding does not create a verified expense, approve a budget change or complete a milestone.

Incoming messages are untrusted content. Their text must not override application permissions or AI instructions. Financial records, bank details, private documents and full internal correspondence must not appear in outbound email. Safe summaries can include public grant information and a link to the authenticated portal. Do not enter banking details into this first release.

Scheduled Functions run from the published production deploy; a preview deploy is not a scheduled-delivery test. Confirm your Netlify account supports the configured schedule and check its function logs.

Weekly and monthly preferences are per organisation. `grant-digest` runs hourly (`0 * * * *`, UTC), processing at most one organisation per invocation. Weekly periods start on Monday and monthly periods follow the calendar month in Australia/Melbourne. It is not a separate deployment per subscriber. Failed attempts have a six-hour cooldown; untried organisations are prioritised. The pilot scans only the first 500 eligible organisations and can attempt at most 168 searches per week, before retries. A durable queue and load testing are required before exceeding that capacity. Users can change the preference to **Never** in their organisation settings. Keep summary links on the configured HTTPS application origin. Test delivery and deduplication before enabling notifications for real users.

## Document conversion and profile preparation

Profile preparation runs extract, independent source check and correction as separate authenticated requests. It shows progress and binds the stages to the same source fingerprint. The source controls are disabled while it runs; switching organisation or user stops the pending completion. A failure returns to the source step with pasted text and selected saved documents preserved. Retry restarts all three stages rather than offering a partial result. Only the final corrected profile is presented for review, with explicit approval and acknowledgement of unresolved discrepancies. Changing the sources requires a new preparation; the AI never approves the profile itself.

Discovery separates grounded search from extraction/save; application drafting separates requirement preflight from generation/save. Both are two authenticated, quota-counted requests. The first phase saves no opportunity/application result. Its actor/organisation/originals/state-bound HMAC receipt lasts 15 minutes and uses the existing `AUTH_RATE_LIMIT_SECRET`; no new AI secret is required. The final phase validates that receipt, reloads the current originals and rechecks requirements before writing. A failed search/draft restarts from its first phase, rather than resuming an unverified partial result.

Each model call is bounded to the remaining request budget, with at most 25 seconds inside a 27-second request. This bounds failure handling; it does not prove hosted provider latency. Scheduled digest discovery retains its bounded synchronous pilot/retry behaviour and is not a new background-job system.

PDF and images are supplied to Gemini in their native supported formats. DOCX and XLSX are parsed into text first; layout, images, charts, signatures and other document structure may be lost. Spreadsheet formulas are not recalculated: any displayed formula result comes from the workbook's saved/cached value and needs review. Export to PDF when visual structure or embedded evidence matters. For AI extraction, HTML/XML are read as evidence text rather than executed. Normalisation handles known browser MIME aliases and empty/generic MIME reports for recognised extensions; renaming a file is not a format conversion.

The parser rejects documents over these limits instead of silently truncating their source text:

| Processing boundary      | Limit                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Upload batch/file        | 10 files per batch; 10 MiB per file                                                                                                 |
| AI selection             | 8 documents; 15 MiB combined original bytes                                                                                         |
| Extracted/text documents | 200,000 characters per file including extraction notes; 400,000 converted-text characters across the selected documents per request |
| Office ZIP               | 512 entries; 20 MiB expanded total; 8 MiB per expanded entry; entries above 1 MiB also have a 200:1 compression-ratio limit         |
| Office XML               | 4,194,304 characters per XML part; maximum depth 128 and 100,000 nodes                                                              |
| Spreadsheet              | 20 sheets; 20,000 actual cells; maximum row 5,000 and column 256; 100,000 expanded matrix cells across sheets                       |

Large files may exceed processing limits despite fitting the upload limit. Split them or export the relevant pages/sheets to smaller PDF/text files. Text formats need UTF-8 or BOM-marked UTF-16 encoding. Encrypted/password-protected, macro-enabled and legacy binary Office formats are rejected; save an unprotected, macro-free DOCX/XLSX copy or export the relevant content as PDF. Office extraction leaves the stored original file unchanged. Unavailable formula results and saved spreadsheet errors are marked rather than treated as verified financial values.

## 4. Local development

For the demonstration experience, do not create a `.env` file:

```sh
npm ci
npm run dev
```

The demonstration uses fictional records and does not call live services. A copied `.env.example` still contains placeholders: non-empty placeholder Supabase values can switch the portal into live mode and break login. They are not a working configuration.

For live local development, copy `.env.example` to the ignored `.env` file, then replace the placeholders with real development values before starting the app. Both browser Supabase values must be valid, and live sign-in also requires the application-specific Resend and durable limiter configuration in `AUTHENTICATION.md`. Placeholder keys do not enable login. Use a separately configured HTTPS development deployment rather than weakening the production canonical-origin checks. To run the actual `/api/*` functions locally, use:

```sh
cp .env.example .env
# Edit .env and replace the placeholders with development configuration first.
npx netlify-cli dev
```

The local Netlify URL is normally `http://localhost:8888`. The plain Vite server does not execute Netlify Functions. The branded login route deliberately requires the configured canonical HTTPS origin, so validate real email sign-in on a separately configured HTTPS deployment, not by weakening checks for local HTTP. Local auth UI/API tests use mocks. Use development service accounts for any deliberate delivery tests; automated tests must not send real messages to charity members.

Validation commands:

```sh
npm run typecheck
npm test
npm run build
```

Passing these checks validates the code and configured test cases. It does not prove that the hosted Supabase project has the dedicated schema installed/exposed, that email DNS is verified, or that live provider credentials work.

## 5. Launch verification

Complete these checks in a staging environment with non-sensitive records before inviting organisations:

- Create two accounts and several organisations. Verify that neither account can read, modify, download, or use AI on an organisation it does not belong to, including by directly calling the APIs.
- Upload supported PDF/image/text and DOCX/XLSX files and confirm private access. Check size/type limits and failed-upload recovery. Add malware scanning, retention/deletion procedures and a documented incident process before accepting unrestricted public uploads.
- Compare all three profile extraction stages against the originals. Confirm that a failed stage gives a retry path, changed sources invalidate the pending result, and only the completed corrected draft can reach manual approval. Keep the final approval with an authorised user. Confirm that drafting is blocked when program guidelines or required evidence are missing.
- Review search results against official grant pages, eligibility, closing date/timezone and guideline version. A search match is not a funding commitment or confirmation of eligibility.
- Test receiving-webhook signatures, duplicate events, unknown senders and organisation isolation. Confirm forwarded invoices remain subject to review.
- Test both notification cadences, **Never**, retry behaviour, duplicate prevention and a protected email deep link.
- Check keyboard navigation, zoom, small screens, screen-reader labels and error recovery with intended users. Keep the everyday flow to a few clear actions.
- Confirm backup/restore, access revocation, log redaction, privacy notices, document retention, AI-provider data terms and Australian overseas disclosure obligations with appropriate advice. An Australian database region does not ensure every AI/email processor stays in Australia.

Organisation-profile AI refuses financial-statement/audit categories; keep those records in the private library and use registration, ACNC and redacted history material for setup. For application/report actions, only documents explicitly selected by an authenticated user are sent to Gemini. Redact banking details, tax file numbers and unnecessary personal data first: an instruction to the model not to disclose something is not document redaction.

The portal drafts content for human review. Grant applications generally must still be submitted through the funder's nominated process by an authorised person, with the correct declarations and attachments. Do not describe an exported draft as a submitted application.

## Current external prerequisites

The repository can be built without production credentials. Live Supabase, Gemini and Resend integrations cannot be declared validated until the hosted installer is applied, `simple_grant` is added to the exposed schemas, the application-specific Resend login and durable limiter are configured, environment variables and DNS are configured, and the staging checks above pass. The shared project's existing Auth settings and other applications must also be checked for regressions. Missing login security configuration returns an unavailable/error state; there is no fallback to the shared Supabase mailer. Optional `EMAIL_AI_REPLIES=true` supports a narrow public-information email assistant. For short messages without attachments or financial keywords, Gemini selects only one of four intents: organisation name, ABN, grants or help. The server then builds a fixed reply using recorded name/ABN or current saved Google-source-backed grant titles, providers, source links and authenticated portal links. Imported/unverified grant records are excluded from these email summaries. No generated model prose or private organisation context is sent in the reply. This does not initiate a new web search per email. Other questions receive a portal handoff. If AI replies are disabled, `EMAIL_AUTO_ACK=true` enables only a fixed receipt; both responses are never sent for the same event. A matching email From address supports routing but is not strong proof of identity; email never authorises ledger changes, approvals or disclosure of private information.

Source-research network access in the build environment may also need the official Australian domains listed in `docs/AUSTRALIAN_GRANTS_RESEARCH.md`; that is separate from Netlify's deployment configuration.
