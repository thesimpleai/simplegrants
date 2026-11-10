# Simple Grants sign-in on a shared Supabase project

Simple Grants sends its own sign-in emails through Resend from **`Simple Grants <login@simplegrants.com.au>`**. The shared Supabase project still issues and verifies the sessions. This gives the application its own email branding, return page and browser session storage; it does **not** create a separate Supabase Auth user pool.

Do not change the shared project's Auth Site URL, SMTP credentials, email templates, signup settings or other applications' redirects. Those settings affect the other applications. The Simple Grants login route does not send through Supabase's project-wide mailer or fall back to it when configuration is missing.

## Roll out without breaking the current login

Keep this change on `fix/simple-grants-auth` until migration 005, the six new Netlify settings, Resend sender verification and Turnstile are configured. Preview builds can validate the interface and mocked tests; with the production `AUTH_APP_URL`, their different Origin is intentionally rejected for live sign-in. Configure the prerequisites below **before merging and deploying this branch to production**. Then request a fresh Simple Grants email and complete the production-domain check.

The updated browser disables native URL session detection. Old Supabase implicit/PKCE email callbacks are intentionally not consumed by Simple Grants after rollout; users must request a fresh application-specific email. The other applications' native login flows remain unchanged.

## Set up once

1. **Apply the database update.** If Simple Grant's dedicated schema already has migrations 001–004, run only [`202611100005_auth_email.sql`](../supabase/migrations/202611100005_auth_email.sql) in the shared project's SQL Editor. For a fresh Simple Grant installation, use the complete [`install-simple-grant.sql`](../supabase/install-simple-grant.sql), which now includes all five migrations in one transaction. Do not rerun the initial installer over an existing installation, reset the schema, or repair the shared project's migration history. Continue exposing `simple_grant` in the Data API as described in [Deployment](DEPLOYMENT.md).
2. **Verify the sending domain in Resend.** Add `simplegrants.com.au` to your Resend account and publish the exact DKIM/SPF DNS records Resend shows. Preserve existing DNS and email routing; do not replace apex MX records or unrelated SPF/DKIM records. Resolve any SPF-record conflict deliberately rather than adding two SPF policies at one hostname. Wait until Resend reports the sending domain as verified. In that dedicated sending domain's Resend settings, keep **click tracking disabled** so one-time login links are not wrapped in tracking redirects. This is a domain setting, not a per-email API flag. The existing `RESEND_API_KEY` must have sending permission for this domain. This step does not require changing the application's existing incoming-email domain.
3. **Create a Cloudflare Turnstile widget.** Allow hostname `simplegrants.com.au`. The server accepts login requests only from the canonical `AUTH_APP_URL` origin; adding a widget hostname alone does not authorise an alternate application origin. Use a separately configured deployment for another login origin. Put its public site key in `VITE_TURNSTILE_SITE_KEY` and its secret key in `AUTH_TURNSTILE_SECRET_KEY`. The application uses action `simple-grants-sign-in`, and the server checks the action and expected hostname. Do not use test keys or disable the challenge on the production site.
4. **Add the new Netlify variables below.** Keep the existing Supabase project URL and keys. Generate a separate strong HMAC secret for `AUTH_RATE_LIMIT_SECRET`; it is not your Resend, webhook or Turnstile key. Give `VITE_TURNSTILE_SITE_KEY` the Builds scope, and the other new values the Functions scope.
5. **Merge, deploy and test the final domain after setup.** Ensure `https://simplegrants.com.au` has working HTTPS in Netlify and make it the primary application domain; redirect aliases to it. Rebuild after adding the public Turnstile key, and retain the repository CSP permissions for the `https://challenges.cloudflare.com` script/frame so the widget can run. After the prerequisites are saved, merge and deploy `fix/simple-grants-auth`. Request a fresh login link from the canonical site using an existing shared Auth account, open the email and confirm sign-in on the application's return page. Check that a grant deep link is restored. Existing Simple Grant sessions use a new application-specific storage key, so users need to sign in again after this update.

DNS, Resend verification, Turnstile configuration and Netlify environment settings require access to those accounts. No real sender verification, login email delivery or hosted callback is claimed by the local tests.

## New environment variables

| Variable                    | Scope          | Value                                                                                                                                                                  |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_APP_URL`              | Functions      | `https://simplegrants.com.au`; canonical HTTPS origin, used for the application-owned return page                                                                      |
| `AUTH_EMAIL_FROM`           | Functions      | `Simple Grants <login@simplegrants.com.au>`; domain must be verified in Resend                                                                                         |
| `AUTH_ALLOW_SIGNUPS`        | Functions      | `false` by default: only existing users in the shared Auth pool receive a link. Set `true` only if Simple Grants should be allowed to create new shared Auth accounts. |
| `VITE_TURNSTILE_SITE_KEY`   | Builds         | Public site key for the hostname-restricted Turnstile widget                                                                                                           |
| `AUTH_TURNSTILE_SECRET_KEY` | Functions only | Matching private Turnstile secret                                                                                                                                      |
| `AUTH_RATE_LIMIT_SECRET`    | Functions only | A separate cryptographically random secret, generated from at least 32 random bytes                                                                                    |

The existing `RESEND_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also needed by the login function. The service role/secret key is privileged across the entire shared project and must stay server-only. `AUTH_EMAIL_FROM` controls login emails; `EMAIL_FROM` continues to control grant summaries and other application emails. Neither changes the shared Supabase SMTP configuration.

To generate a secret without printing it in a terminal or chat, run this locally in a private directory and copy the resulting value directly into secure Netlify settings:

```sh
(umask 077; set -C; node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"))' > simple-grants-auth-rate-limit-secret.txt)
```

The command refuses to overwrite an existing file. Keep the file out of the repository and delete it when it is no longer needed. Do not paste the secret into chat or reuse another integration's key.

## How it works

1. The browser completes Turnstile and calls `/api/auth-email`. It does not call `signInWithOtp` or ask Supabase to send its project-wide template.
2. The server validates the challenge, action, hostname and request, then claims a durable email/IP quota. The database stores HMAC fingerprints and timestamps, not raw email addresses or IP addresses in the limiter table.
3. The server asks Supabase Admin to generate the one-time email token and sends a Simple Grants email through Resend. The token is placed in the fragment of an application-owned `/auth/confirm` URL; it is not returned to the requesting browser or written to logs.
4. The page clears the token fragment from the address bar and holds it only for this confirmation. The user explicitly chooses **Sign in**. The browser verifies the token with Supabase, stores the application's session separately, and returns only to a validated path on the application origin. A link being opened by an email scanner does not by itself submit the confirmation button.
5. Logout revokes this application's local session. It does not request a project-wide sign-out of the user's other applications.

No additional Supabase Auth redirect entry is required for this generated-token callback: the application constructs and verifies its own return page. Leave existing project redirects alone. Supabase's native/older email flow remains available to the other applications and keeps its existing branding; request a new Simple Grants login email after deploying this flow.

With `AUTH_ALLOW_SIGNUPS=false`, an unknown address receives the same outward acknowledgement as an existing address, but no account or email is created. The response does not disclose account or delivery status. Provider timing can still differ; Turnstile and durable quotas reduce abuse. HTTP 202 is not proof of delivery: account-dependent token or sending failures also return the generic acknowledgement. Check Resend delivery logs when an expected message does not arrive. With `true`, newly created accounts belong to the shared Auth pool; it does not automatically grant them membership of another application or an existing organisation.

The limiter permits at most five claimed requests per email per hour and twenty per IP per hour, with a sixty-second per-email cooldown. Quota suppression has the same generic acknowledgement as an accepted request, including for unknown addresses; it does not disclose account or delivery status. Missing required configuration or unavailable durable security checks fail closed; the client does not silently switch to another application's mailer. Turnstile failures, rate limits, expired links and already-used links require the user to retry or request a fresh email as appropriate.

## Verify before inviting users

- Confirm the email actually arrives from the verified `simplegrants.com.au` sender and opens the canonical HTTPS application domain.
- Test a known account and, if intentionally enabled, a new account. With signups disabled, test the generic response for an unknown address without expecting delivery.
- Test a grant deep link, a used/expired token and an invalid or replayed challenge.
- Verify that a login request with missing configuration cannot send a project-wide Supabase email.
- Sign into another application in the shared project, then sign into and out of Simple Grants. Confirm that the other application's session and email branding remain unchanged.

One-time email-token state also remains shared: requesting a Simple Grants link can supersede a pending magic link for the same account in another application. Existing signed-in sessions and app-local logout remain separate; pending email links are not independent. Another application that still requests a project-wide logout can revoke shared-user sessions, including Simple Grants. This update does not change that other application’s logout behaviour.

A dedicated Supabase project would be required if you later need fully independent Auth users, one-time email-token state, global auth policy or SMTP configuration. This implementation deliberately keeps the existing shared pool.
