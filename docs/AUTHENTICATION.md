# Simple Grants sign-in on a shared Supabase project

Simple Grants sends its own sign-in emails through Resend from **`Simple Grants <login@simplegrants.com.au>`**. It uses the existing Supabase, Resend and Netlify services; no additional provider account is required. Supabase still issues and verifies the sessions, so the Auth user pool remains shared. The application has its own email branding, return page and browser session storage.

Keep the shared project's Auth Site URL, SMTP credentials, email templates, signup settings and other applications' redirects unchanged. The Simple Grants login route sends through Resend and does not fall back to the project-wide Supabase mailer when configuration is missing.

## Production setup and verification

Deploy the application from `main`. A GitHub update and a completed Netlify production deploy are separate events; confirm the deployed revision before checking the live login. Check which prerequisites are already configured before applying the steps below; skip migrations that are already installed. Local tests do not verify provider account settings or real delivery. Preview origins remain intentionally rejected by the production `AUTH_APP_URL` check.

1. **Apply the database update.** If Simple Grant has migrations 001–004 but not 005, run only [`202611100005_auth_email.sql`](../supabase/migrations/202611100005_auth_email.sql) in the shared project's SQL Editor. Do not rerun migration 005 if it is already installed. A fresh installation uses the complete [`install-simple-grant.sql`](../supabase/install-simple-grant.sql), containing all six migrations in one transaction. Do not rerun the initial installer over an existing installation, reset the schema or repair shared migration history. Continue exposing `simple_grant` in the Data API as described in [Deployment](DEPLOYMENT.md).
2. **Verify the sending domain in Resend.** Add `simplegrants.com.au` and publish the exact DKIM/SPF DNS records Resend shows. Preserve existing DNS and mail routing; do not replace apex MX records or unrelated SPF/DKIM records. Resolve SPF conflicts deliberately rather than adding two SPF policies at one hostname. Wait for Resend's verified status. Keep **click tracking disabled** on this sending domain so one-time links are not wrapped in tracking redirects. The existing `RESEND_API_KEY` must have sending permission for this domain. The application's incoming-email domain can stay as it is.
3. **Add the four Netlify variables below.** Keep the existing Supabase URL and keys. Generate a separate strong HMAC secret for `AUTH_RATE_LIMIT_SECRET`; do not reuse a Resend or webhook key. Give all four values the Functions scope. Keep `AUTH_ALLOW_SIGNUPS=false` while testing with existing shared Auth users. Set it to `true` only when intentionally opening new-user onboarding.
4. **Deploy `main` and check the final domain.** Ensure `https://simplegrants.com.au` has working HTTPS and is Netlify's primary application domain. Redirect aliases to it. Deploy the current `main` revision after the prerequisites are configured and wait for Netlify to complete that production deployment. Request a fresh login email from the canonical site, open it and choose **Sign in** on the return page. Check that a grant deep link is restored and that another application's session still works.

Existing Simple Grant sessions need a fresh sign-in after this update because the browser storage key changes. Native URL session detection is disabled: old Supabase implicit/PKCE email callbacks are intentionally not consumed by Simple Grants. Request a fresh application-specific email after rollout. Other applications' native login flows remain unchanged.

DNS, Resend verification and Netlify settings require access to those accounts. Local tests do not establish sender verification, real email delivery or hosted callback behaviour.

## Four new environment variables

| Variable                 | Scope          | Value                                                                                                                                    |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_APP_URL`           | Functions      | `https://simplegrants.com.au`; canonical HTTPS origin for login and the application-owned return page                                    |
| `AUTH_EMAIL_FROM`        | Functions      | `Simple Grants <login@simplegrants.com.au>`; domain must be verified in Resend                                                           |
| `AUTH_ALLOW_SIGNUPS`     | Functions      | `false` default: links go only to existing users in the shared Auth pool. `true` explicitly allows creation of new shared Auth accounts. |
| `AUTH_RATE_LIMIT_SECRET` | Functions only | Separate cryptographically random HMAC secret, generated from at least 32 random bytes                                                   |

The login function also uses the existing `RESEND_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service role/secret key is privileged across the entire shared project and must stay server-only. `AUTH_EMAIL_FROM` controls login emails; `EMAIL_FROM` still controls grant summaries and other application emails. Neither changes Supabase's shared SMTP configuration.

Generate a secret locally in a private directory without printing it in a terminal or chat, then copy its value directly into secure Netlify settings:

```sh
(umask 077; set -C; node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"))' > simple-grants-auth-rate-limit-secret.txt)
```

The command refuses to overwrite an existing file. Keep it outside the repository, delete it when no longer needed, and never paste the value into chat.

## How it works

1. The browser submits the email to `/api/auth-email`. It does not call `signInWithOtp` or ask Supabase to send its project-wide template.
2. The server checks the exact canonical Origin and validates the request. It takes the IP from Netlify's function context, rather than trusting arbitrary forwarded headers, and claims a durable email/IP quota. The limiter stores HMAC fingerprints and timestamps rather than raw emails or IP addresses. An optional hidden `website` field filters some basic autofill bots.
3. Supabase Admin generates a one-time token, and Resend sends the application's email. The token is in the fragment of an application-owned `/auth/confirm` URL. It is not included in the requesting API response or written to logs.
4. The return page clears the fragment from the address bar and holds the token only for confirmation. The user explicitly chooses **Sign in** before it is verified with Supabase. The application then returns to a validated portal path on its own origin. Simply opening the email link does not submit that confirmation button.
5. Logout revokes the application's local session, preserving the user's other sessions rather than requesting a project-wide sign-out.

No additional Supabase Auth redirect entry is required for this generated-token callback. Leave the existing project redirects alone. Supabase's native/older email flow remains available to the other applications with its existing branding.

The limiter allows five claimed requests per email per hour and twenty per IP per hour, with a sixty-second per-email cooldown. Unknown addresses, suppressed requests and account-dependent token/sending failures receive the same generic HTTP 202 acknowledgement. That response does not disclose account or delivery status, and it is not proof of delivery. Provider timing can still differ. Check Resend delivery logs when an expected message does not arrive. Missing common configuration or an unavailable durable limiter blocks the request; the client never silently switches mailers.

There is no CAPTCHA in this flow. Automated clients can spoof an Origin header and omit a honeypot; distributed bots can work around individual IP limits. Existing-user-only delivery and per-email quotas reduce unwanted mail, but do not eliminate abuse. Enabling public signups increases that exposure. Monitor delivery volume and provider costs, and add stronger challenges later if observed abuse requires them.

## If sign-in says “temporarily unavailable”

The message alone does not identify the cause. The diagnostic update adds a safe reference; it improves diagnosis rather than proving that a configuration or DNS fault exists.

1. **Check the deployed revision.** Confirm that Netlify's completed production deploy matches the current GitHub `main` commit. After the diagnostic update is deployed, make one fresh request from `https://simplegrants.com.au` and note its time, `SG_AUTH_…` code and reference. Server failures include a UUID reference; browser response/network fallbacks may have only their fixed code. If no reference appears, first confirm the deployed revision and whether the function ran.
2. **Read the `auth-email` Function logs.** In this site's Netlify Function logs, select `auth-email` and find `Simple Grants authentication unavailable` with that reference. Its safe fields are `stage`, `databaseCode`, `code` and `reference`. Share only those labels when asking for help; keep key values, addresses, request headers and login links private.
3. **Follow the relevant check below.** In the production **Functions** scope, check the presence of `AUTH_RATE_LIMIT_SECRET`, `RESEND_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Review all four auth settings above, including canonical origin and sender. The server URL/key must belong to the intended same project. Builds-only values are unavailable to Functions. Redeploy after a diagnosed scope/configuration change.
4. **For a database-stage failure, run the read-only diagnostic.** In the intended Supabase project's SQL Editor, run [`supabase/diagnostics/auth-email.sql`](../supabase/diagnostics/auth-email.sql). It checks catalog objects and grants without calling application RPCs or reading user records.

| Code | First check |
| --- | --- |
| `SG_AUTH_SETUP` | Log `stage`: canonical origin, trusted Netlify client IP, required environment values or client construction. |
| `SG_AUTH_SCHEMA` | The intended `simple_grant` schema and its Data API exposure; preserve the other exposed schemas. |
| `SG_AUTH_RPC` | Required table/helper signatures and migration 005 status; also check the REST schema cache. |
| `SG_AUTH_ACCESS` | The server key's project/role and required service-role grants; use the diagnostic before changing permissions. |
| `SG_AUTH_DATABASE` | The safe `databaseCode`: other RPC, transport or unexpected-response failures need diagnosis from that evidence. |
| `SG_AUTH_RESPONSE` | Browser-only fallback: inspect the deployed function/route and HTTP status. HTML or an unexpected API response is not an accepted email request. |
| `SG_AUTH_NETWORK` | Browser request did not complete. Check connectivity and whether a matching function invocation exists; this does not identify a DNS/configuration fault. |

The SQL result's `database_prerequisites` distinguishes `objects_missing`, `wrong_permission`, `wrong_configuration` and `ready`. A ready schema with the limiter table and both helpers absent matches an 001–004 installation without 005; confirm the intended project/version before applying a repair. `ready` covers database prerequisites only. `api_schema_setting.status=unknown` is inconclusive because the SQL session cannot always observe managed Data API settings.

Do not blindly rerun migration 005 or the full installer. Keep shared Auth settings and the limiter unchanged; do not rotate working keys or enable signups as a workaround. Account-dependent token/sending failures still use the generic HTTP 202 acknowledgement, so it is not proof of delivery. For that different outcome, inspect Resend delivery logs for the expected message.

## Verify before inviting users

- Confirm that an email arrives from the verified `simplegrants.com.au` sender and opens the canonical HTTPS application domain.
- Test a known account and, when intentionally enabled, a new account. With signups disabled, an unknown address gets a generic acknowledgement without account creation or delivery.
- Test a grant deep link, a used/expired token, rate suppression and a filled honeypot field.
- Confirm missing configuration cannot trigger a project-wide Supabase email.
- Sign into another application, then sign into and out of Simple Grants. Check that its existing session and email branding remain unchanged.

One-time email-token state remains shared: requesting a Simple Grants link can supersede a pending magic link for the same account in another application. Existing signed-in sessions and app-local logout remain separate; pending email links are not independent. Another application that still requests project-wide logout can revoke shared-user sessions, including Simple Grants; this update does not change that application's behaviour.

A dedicated Supabase project is required for fully independent Auth users, pending email-token state and global auth policies. This implementation uses the shared pool.
