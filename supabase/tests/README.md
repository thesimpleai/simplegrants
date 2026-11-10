# Database security regression

Run `bash supabase/tests/run-local.sh` from a machine with Docker. It creates a disposable, network-isolated PostgreSQL 17 container, loads minimal Supabase `auth`/`storage` stubs, applies the real migration, and executes `rls.sql`. The image is pinned to the official manifest digest used during development. The script fails on any SQL error or failed assertion and removes its container on exit.

`bootstrap-local.sql` is **test scaffolding only**. Never run it in Supabase or a production database. It does not implement Supabase Auth, Storage validation, email delivery, or API behavior. The local test establishes PostgreSQL and RLS logic only.

On a disposable Supabase project, apply the migration normally and execute `rls.sql` as a database administrator. The script creates isolated users and records inside a transaction and rolls everything back. It intentionally uses reserved `.invalid` email addresses and never sends email. Do not run this script concurrently against the same database: test user IDs are fixed.

Covered checks: pre-existing public bucket rejection with full migration rollback and original bucket preservation; atomic initial-owner creation; input validation; tenant read/write isolation; same-tenant foreign keys; immutable tenant linkage; viewer read/no-write restrictions; no client membership escalation; private object access; invalid path rejection; metadata prefix spoof rejection; service-only job claiming; duplicate/retry/completed-event behavior; durable per-user AI quotas shared across organisations; unauthorised actions and counter tampering rejection; service-only email quota access and combined portal/email limits.

Hosted integration still requires testing sign-in, redirects, real object uploads/downloads, browser application flows, scheduled jobs, and signed Resend webhooks after credentials are configured.
