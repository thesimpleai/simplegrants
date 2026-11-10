# Deploy Simple Grant

Simple Grant has a React portal, Netlify Functions, Supabase Auth/Postgres/private Storage, Gemini for assisted work, and Resend for receiving and sending email. Netlify hosts the application; it does not replace the Supabase database or the email DNS configuration.

The demonstration mode works without service keys and contains fictional records. It is for evaluating the interface. Live authentication, organisation data, AI calls, receiving email and scheduled summaries require the services below. Never use demonstration records as real funding opportunities.

## 1. Create and connect Supabase

1. Create a Supabase project in your own account. Choose an Australian region, such as Sydney, if available and suitable for your requirements. Record the project reference and Project URL from the project settings.
2. Review **all** SQL files in `supabase/migrations/`. Apply each file in filename order through the Supabase SQL Editor. Together these create the tenant tables, access policies, helper functions, private document bucket, shared portal/email AI quota and saved report-draft field. No application seed data is required. The private `documents` bucket accepts PDF, JPEG, PNG, WebP and plain text files up to 10 MiB each; export Word or spreadsheet material as PDF before uploading. AI requests allow at most eight selected documents totalling 15 MiB.
3. Alternatively, use the CLI from the repository root:

   ```sh
   npx supabase login
   npx supabase init
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   ```

   Authenticate using the CLI's supported login flow or a securely injected `SUPABASE_ACCESS_TOKEN`. The project database password, if requested, belongs in the CLI's secure prompt. Do not put access tokens, database passwords or API secrets in chat, source code or committed files. Run `supabase init` only when no local `supabase/config.toml` exists; do not overwrite an existing configuration. Run `db push` only against the intended project after reviewing its proposed migrations.

4. Enable email authentication. Set **Authentication → URL Configuration → Site URL** to your final Netlify/custom domain. The login flow preserves grant deep links such as `/?org=…&view=opportunities&grant=…`. Allow those paths and query strings on the exact canonical hostname, for example `https://YOUR_SITE/**`, in **Redirect URLs**. For local Netlify development, add `http://localhost:8888/**`. Add staging origins individually if needed; do not allow arbitrary hosts or a broad `*.netlify.app` wildcard. Keep **Site URL** set to the canonical production origin.
5. Review whether public account creation should be enabled; restrict signups during a private pilot. For production login emails, configure Supabase custom SMTP. Resend can supply the SMTP credentials; this is a separate configuration from the application's `RESEND_API_KEY`. Supabase's default mail service has delivery and rate restrictions and should not be assumed suitable for public launch.
6. In Supabase's API settings, obtain the public anon/publishable key and the server-only service role key. Copy them directly into the appropriate Netlify environment settings below.

You do not need to give this assistant access to your Supabase account. Applying the migration and entering keys in Netlify is sufficient. If you want the assistant to apply migrations later, provide a securely authenticated CLI environment scoped to the intended project, or an available Supabase integration. Share the project reference and URL as ordinary configuration, but provide access credentials through secure environment settings rather than chat.

Row-level security is the boundary between organisations. One login can own multiple organisations. New organisations are created with an atomic database RPC that also adds the initial owner. Service-role access is reserved for server work and bypasses RLS, so it must never be present in the browser. The first release does not include a self-service team invitation interface.

## 2. Connect Netlify to GitHub

1. In Netlify, import `thesimpleai/simplegrants` and select the branch containing the application.
2. Use the repository's `netlify.toml`: Node 22, build command `npm run build`, publish directory `dist`, and functions directory `netlify/functions`.
3. Add the environment variables below. Public Vite values must be available during the build. All other API keys must be available to Functions, including scheduled functions. Give preview deploys separate non-production service credentials, or leave their live integrations disabled.
4. Deploy. Changing a `VITE_` variable requires rebuilding the frontend. Redeploy after changing runtime secrets so the deployed functions receive the intended configuration.
5. Set the final domain in Supabase's auth redirect configuration. Test a complete sign-in round trip and a link directly to a grant; the grant should remain behind authentication.

### Required environment variables

| Variable                    | Used by        | Value                                                                                    |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | Browser/build  | Your Supabase Project URL                                                                |
| `VITE_SUPABASE_ANON_KEY`    | Browser/build  | Your project's public anon/publishable key                                               |
| `SUPABASE_URL`              | Functions      | The same Project URL                                                                     |
| `SUPABASE_ANON_KEY`         | Functions      | The same public anon/publishable key                                                     |
| `SUPABASE_SERVICE_ROLE_KEY` | Functions only | Supabase service role key; privileged, never public                                      |
| `GEMINI_API_KEY`            | Functions only | Gemini API key for a project with billing/quota and the required model access            |
| `GEMINI_MODEL`              | Functions      | `gemini-flash-latest` by default; configurable model identifier                          |
| `RESEND_API_KEY`            | Functions only | Resend API key with the required sending and receiving API access                        |
| `RESEND_WEBHOOK_SECRET`     | Functions only | Signing secret of the receiving webhook, not the sending API key                         |
| `EMAIL_AI_REPLIES`          | Functions      | Optional `false` default; enables tightly restricted public-information question replies |
| `EMAIL_AUTO_ACK`            | Functions      | Optional `false` default; fixed public receipt used only when AI replies are disabled    |
| `EMAIL_FROM`                | Functions      | A verified sender, e.g. `Simple Grant <grants@thesimpleai.com>`                          |
| `INBOUND_EMAIL_DOMAIN`      | Functions      | Your configured receiving domain, e.g. `mail.thesimpleai.com`                            |
| `VITE_INBOUND_EMAIL_DOMAIN` | Browser/build  | The same public receiving domain, used to show your organisation inbox address           |
| `URL`                       | Functions      | Netlify supplies the site's canonical URL; used for authenticated portal links           |

No Gemini key, Resend key or Supabase service role key should have a `VITE_` prefix. Vite bundles variables with that prefix into downloadable browser code.

Create the Gemini key in your Google AI Studio/Google Cloud project and the Resend key in Resend. Enter both into Netlify; the Resend key does not belong in Gemini settings.

The Flash alias can change its underlying model. Before launch, verify that the selected model supports the document formats and Google Search grounding this application uses. Pin `GEMINI_MODEL` to a tested stable Flash model if you need predictable behaviour and cost. Configure quota and budget limits in the provider account. The database also limits portal and eligible public-email AI requests to a shared 60 per user per UTC day across organisations; this is a request count, not a token or dollar cap. Profile requests use three model passes, and scheduled discovery has separate consumption. This setup does not claim that a particular preview model is the latest supported production model.

## 3. Configure email and your domain

The product brief mentions both `thesimpleai.com` and `simpleai.com.au`. Use the domain you actually own; the application does not assume they are interchangeable. The sample configuration uses `thesimpleai.com` for sending and `mail.thesimpleai.com` for receiving.

1. Verify the sending domain in Resend by adding its specified DNS records, including the required SPF/DKIM records. Follow Resend's current instructions for DMARC and domain alignment.
2. Enable receiving for a dedicated subdomain, such as `mail.thesimpleai.com`, and add Resend's prescribed MX records for that subdomain. A subdomain avoids replacing the MX records used by an existing staff mailbox. Do not change the apex domain's existing mail routing without reviewing its impact.
3. Set `EMAIL_FROM`, `INBOUND_EMAIL_DOMAIN` and `VITE_INBOUND_EMAIL_DOMAIN` to the verified configuration. Organisations receive individual aliases under that domain. Keep the alias shown in the portal consistent with the configured receiving domain.
4. In Resend, create an `email.received` webhook pointing to:

   ```text
   https://YOUR_SITE/.netlify/functions/inbound-email
   ```

   The `/api/inbound-email` route also maps to the function. Copy this webhook's signing secret into `RESEND_WEBHOOK_SECRET` and redeploy.

5. Send a test from the verified email address of a signed-in organisation member. Confirm that the message appears only in that organisation's inbox. Unknown senders must not gain access to organisation data or trigger disclosure replies.
6. Forward a harmless sample invoice. This release records the email body and **attachment metadata only**; attachment file bytes are not downloaded into Supabase. Upload the actual invoice separately through the portal if it needs to be retained. Forwarding does not establish a verified expense, an approved budget change or a completed milestone.

Incoming messages are untrusted content. Their text must not override application permissions or AI instructions. Financial records, bank details, private documents and full internal correspondence must not appear in outbound email. Safe summaries can include public grant information and a link to the authenticated portal. Do not enter banking details into this first release.

Scheduled Functions run from the published production deploy; a preview deploy is not a scheduled-delivery test. Confirm your Netlify account supports the configured schedule and check its function logs.

Weekly and monthly preferences are per organisation. `grant-digest` runs hourly (`0 * * * *`, UTC), processing at most one organisation per invocation. Weekly periods start on Monday and monthly periods follow the calendar month in Australia/Melbourne. It is not a separate deployment per subscriber. Failed attempts have a six-hour cooldown; untried organisations are prioritised. The pilot scans only the first 500 eligible organisations and can attempt at most 168 searches per week, before retries. A durable queue and load testing are required before exceeding that capacity. Users can change the preference to **Never** in their organisation settings. Keep summary links on the configured HTTPS application origin. Test delivery and deduplication before enabling notifications for real users.

## 4. Local development

For the demonstration experience, do not create a `.env` file:

```sh
npm ci
npm run dev
```

The demonstration uses fictional records and does not call live services. A copied `.env.example` still contains placeholders: non-empty placeholder Supabase values can switch the portal into live mode and break login. They are not a working configuration.

For live local development, copy `.env.example` to the ignored `.env` file, then replace the placeholders with real development values before starting the app. At minimum, both browser Supabase values must be valid for sign-in; the server variables enable the corresponding integrations. To exercise authentication and the actual `/api/*` functions locally, use:

```sh
cp .env.example .env
# Edit .env and replace the placeholders with development configuration first.
npx netlify-cli dev
```

The local Netlify URL is normally `http://localhost:8888`. The plain Vite server does not execute Netlify Functions. Use local/development service accounts when testing email; tests must not send real messages to charity members.

Validation commands:

```sh
npm run typecheck
npm test
npm run build
```

Passing these checks validates the code and configured test cases. It does not prove that a new Supabase project has the migration installed, that email DNS is verified, or that live provider credentials work.

## 5. Launch verification

Complete these checks in a staging environment with non-sensitive records before inviting organisations:

- Create two accounts and several organisations. Verify that neither account can read, modify, download, or use AI on an organisation it does not belong to, including by directly calling the APIs.
- Upload supported PDF/image/text files and confirm private access. Check size/type limits and failed-upload recovery. Add malware scanning, retention/deletion procedures and a documented incident process before accepting unrestricted public uploads.
- Compare all three profile extraction stages against the originals. Keep the final approval with an authorised user. Confirm that drafting is blocked when program guidelines or required evidence are missing.
- Review search results against official grant pages, eligibility, closing date/timezone and guideline version. A search match is not a funding commitment or confirmation of eligibility.
- Test receiving-webhook signatures, duplicate events, unknown senders and organisation isolation. Confirm forwarded invoices remain subject to review.
- Test both notification cadences, **Never**, retry behaviour, duplicate prevention and a protected email deep link.
- Check keyboard navigation, zoom, small screens, screen-reader labels and error recovery with intended users. Keep the everyday flow to a few clear actions.
- Confirm backup/restore, access revocation, log redaction, privacy notices, document retention, AI-provider data terms and Australian overseas disclosure obligations with appropriate advice. An Australian database region does not ensure every AI/email processor stays in Australia.

Organisation-profile AI refuses financial-statement/audit categories; keep those records in the private library and use registration, ACNC and redacted history material for setup. For application/report actions, only documents explicitly selected by an authenticated user are sent to Gemini. Redact banking details, tax file numbers and unnecessary personal data first: an instruction to the model not to disclose something is not document redaction.

The portal drafts content for human review. Grant applications generally must still be submitted through the funder's nominated process by an authorised person, with the correct declarations and attachments. Do not describe an exported draft as a submitted application.

## Current external prerequisites

The repository can be built without production credentials. Live Supabase, Gemini and Resend integrations cannot be declared validated until you create/link the service projects, enter the environment variables, configure DNS and complete the staging checks above. Optional `EMAIL_AI_REPLIES=true` supports a narrow public-information email assistant. For short messages without attachments or financial keywords, Gemini selects only one of four intents: organisation name, ABN, grants or help. The server then builds a fixed reply using recorded name/ABN or current saved Google-source-backed grant titles, providers, source links and authenticated portal links. Imported/unverified grant records are excluded from these email summaries. No generated model prose or private organisation context is sent in the reply. This does not initiate a new web search per email. Other questions receive a portal handoff. If AI replies are disabled, `EMAIL_AUTO_ACK=true` enables only a fixed receipt; both responses are never sent for the same event. A matching email From address supports routing but is not strong proof of identity; email never authorises ledger changes, approvals or disclosure of private information.

Source-research network access in the build environment may also need the official Australian domains listed in `docs/AUSTRALIAN_GRANTS_RESEARCH.md`; that is separate from Netlify's deployment configuration.
