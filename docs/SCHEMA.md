# Supabase data model

Simple Grant uses its own `simple_grant` schema and private `simple-grant-documents` bucket inside a shared Supabase project. It does not reuse `public.documents`, move another application's tables, modify existing functions, change Auth configuration, or update another application's migration history. All table and function names below belong to `simple_grant` unless otherwise stated.

## Shared-project installation

1. Save the single JSON result from the read-only `supabase/verify-shared-project.sql` before installing. This captures object names/status and an unrelated catalog/config fingerprint, not application records or credentials.
2. Run `supabase/install-simple-grant.sql` once in the selected project's SQL Editor. The generated script wraps all four canonical baselines in **one transaction**. It deliberately fails if the `simple_grant` schema already exists; investigate rather than dropping it or forcing a rerun. If its dedicated bucket already exists but is public or has incompatible MIME/size settings, the whole installation rolls back without reconfiguring that bucket.
3. Append `simple_grant` to the project's existing API exposed schemas list, preserving every existing entry. The application explicitly targets that schema and the dedicated bucket; it has no `public` fallback.
4. Run the read-only verification query again. Compare `unrelated_metadata_fingerprint` and `unrelated_object_count` with the saved pre-install result. A match is evidence of unchanged catalog/config metadata only; it does not verify application records, hosted API behavior, or the correctness of old policies. Without a pre-install result, do not claim historical equality.

Use `node supabase/build-installer.mjs` to regenerate the installer and `node supabase/build-installer.mjs --check` (or `npm run db:check`) to check it matches the four canonical files. Do not run `supabase db push`, `db reset`, or migration repair against shared SH Sales/CFO history. These baselines are not an upgrade or automatic data migration from any legacy `public` Simple Grant installation.

Preserve the shared project's existing Auth Site URL, SMTP/signup settings and redirects. Add the new portal redirect URL without replacing existing entries. A project service-role credential can access other applications' data by design; keep it server-side. Namespace and RLS isolation do not isolate the trusted SQL administrator or a compromised service-role key.

## Organisation ownership

A login can belong to any number of organisations. `organization_members` is the source of truth for tenant access. Authenticated clients call `create_organization(p_name, p_frequency)` to atomically create an organisation and their `owner` membership. No client can insert, update, or remove membership records. Team invitation and role management are future server-mediated workflows; do not grant a client the service role key to work around this.

| Role   | View organisation and evidence | Change profile, applications and evidence | Delete organisation |
| ------ | ------------------------------ | ----------------------------------------- | ------------------- |
| owner  | Yes                            | Yes                                       | Yes                 |
| admin  | Yes                            | Yes                                       | No                  |
| member | Yes                            | Yes                                       | No                  |
| viewer | Yes                            | No                                        | No                  |

The organisation profile's `verification_status` records human approval (`draft`, `review`, `approved`), not verification by ACNC or an auditor. `documents.verified` is a user review flag, not an audit opinion. Store no bank details in the profile. Uploaded evidence can contain personal or financial information and remains private.

## Main records

- `organizations`: organisation identity, flexible profile JSON, Australian state, focus areas, notification frequency and random inbound email alias. The alias is not an authentication mechanism; inbound processing must still verify provider signatures and the sender's membership.
- `documents`: private evidence metadata. Object paths start with the organisation UUID. PDF, PNG, JPEG, WEBP and plain text are allowed, with a 10 MiB bucket limit. The application may enforce a lower transfer or AI processing limit. Files are not public. If a pre-existing `simple-grant-documents` bucket is public or its MIME/file-size settings differ, the migration fails and rolls back rather than reusing or modifying it. Resolve that dedicated bucket naming conflict before retrying; never reuse or reconfigure another application's bucket.
- `opportunities`: source URL, provenance, known opening and closing times, guidelines, eligibility requirements and estimated match score. Unknown values remain null. Source provenance does not prove eligibility.
- `applications`: original opportunity, project information, AI-assisted draft, review/submission status and the external submission reference. A status change is not an automated funder submission.
- `funded_projects`: accepted funding, original proposal, budget JSON, milestones, reporting date and persisted `report_draft` JSON object. Draft reports remain subject to human review and external submission.
- `expenses`: non-negative expenditure and optional evidence document, attached to a funded project.
- `inbox_messages`: inbound communications and attachment metadata, requiring review before affecting a budget or grant record.
- `activity_log`: server-authored event history, visible to organisation members. Clients cannot forge log entries.

Every dependent record carries `org_id`. Composite foreign keys enforce that an application's opportunity, project's application, expense's project/document, and inbox message's project belong to that same organisation. Triggers prevent changing an existing record's organisation. Membership helper functions are `SECURITY DEFINER` with fully qualified references and empty `search_path` to avoid recursive RLS and object-shadowing attacks.

Private Storage policies separately enforce membership for the first path component. Four Simple Grant permissive policies allow appropriate member operations. Four additional `AS RESTRICTIVE ... TO PUBLIC` policies fence only `simple-grant-documents`, because an existing project's permissive policies combine with OR and might otherwise expose it. Their conditions evaluate true for every other bucket, preserving existing access rules. They apply to every non-BYPASSRLS role, including anonymous and custom application roles. The service role intentionally bypasses RLS.

Only the safe membership boolean and path-parsing helpers are publicly executable; unauthenticated membership checks return false. They need schema USAGE/function EXECUTE even when PostgreSQL initializes a storage expression for another bucket. Public roles receive no table rights, schema CREATE, organisation-creation RPC, or service-job RPC access. Inherited default ACL grants are removed on newly created Simple Grant objects only, then the intended ACLs are granted. Existing global defaults, public tables and functions remain unchanged.

Existing restrictive Storage policies continue to apply and may legitimately block the new bucket. Their names alone cannot establish compatibility; inspect their actual expressions and test hosted storage after installation. Do not remove or relax another application's policies to make uploads pass. Signed URLs, if created, are temporary bearer access and should not be emailed or logged.

## Service-only processing

`notification_runs` has a unique `(org_id, period_key)`. `claim_notification_run(p_org_id, p_period_key)` atomically claims a new, failed, or stale processing run. Columns are `id`, `org_id`, `period_key`, `status` (`processing`, `sent`, `failed`), `last_error`, `provider_message_id`, `started_at`, and `completed_at`.

`webhook_events` uses the provider `event_id` as its primary key. `claim_webhook_event(p_event_id, p_event_type)` atomically claims new, failed, or stale processing deliveries. Columns are `event_id`, `event_type`, `status` (`processing`, `processed`, `rejected`, `failed`), optional `org_id`, `received_at`, `processed_at`, and `last_error`.

Both claim functions and both tables are service-role only. A processing lease is reclaimable after 15 minutes; completed or rejected events cannot be reclaimed. Providers and workers must also use deterministic email idempotency keys, and attachment storage should use deterministic object paths, because database claiming cannot alone guarantee exactly-once external delivery. Never mark a notification `sent` until the email provider accepts it. Do not put sensitive request bodies, API keys or document contents into error metadata.

## Deployment verification

The exact generated installer is exercised against disposable PostgreSQL 17 with minimal Supabase `auth`/`storage` stubs and a representative shared-app fixture. That fixture includes an existing `public.documents` row, colliding public function names, private/public legacy buckets, broad legacy permissive storage access, an unrelated restrictive finance-bucket policy, pre-existing CLI history, and global default ACL grants to anonymous/authenticated/custom roles.

The regression compares unrelated metadata fingerprints before and after installation; checks the legacy document/history sentinel records and old storage behavior; and exercises Simple Grant organisation ownership, tenant/foreign-key isolation, role restrictions, storage read/write/update/delete boundaries for anonymous/authenticated/custom roles, inherited-ACL cleanup, service-only job claiming and shared AI quotas. A public dedicated-bucket conflict must roll the entire installer back. Reapplying the baseline must fail safely rather than silently reuse a namespace.

This validates PostgreSQL logic, not the hosted Supabase Auth, Storage API, API-schema exposure or live email/Gemini integrations. No hosted database has been modified or verified by these local tests. Run `bash supabase/tests/run-local.sh` for the disposable test. Never run fixture/bootstrap/security-test writes against a live shared project. Hosted readiness still requires its separate sign-in, storage and application checks after configuration.

## Durable AI request budget

`ai_usage` is a service-only table keyed by `(user_id, usage_date)`. Authenticated callers execute `claim_ai_request(p_org_id, p_action)` immediately before a billable AI operation. The function requires membership, and requires owner/admin/member editing privileges for every action except `ask`. Only `profile`, `discover`, `import-grant`, `draft`, `ask`, and `report` are accepted. An atomic conditional upsert enforces at most 60 user-initiated requests per user per UTC calendar day across all their organisations. Calls above the limit return `false`; unauthorised or invalid actions raise an error. Clients cannot read, alter, or reset the counter. Failed downstream operations still consume a claimed request; a three-stage profile extraction consumes one request, not three. This is an application guardrail, not a provider billing limit or global organisation quota; scheduled service jobs require their separate scheduler bounds.

`claim_email_ai_request(p_org_id, p_user_id)` is a service-role-only counterpart for the optional public-only inbound email reply worker. It verifies the explicitly supplied user's organisation membership, then atomically consumes the same user/UTC-day counter. It cannot be executed by authenticated or anonymous clients. Portal and email requests together are capped at 60 per user per day. The webhook must verify its provider signature and sender membership before calling this helper; the helper does not establish email authenticity or authorise access to private documents.
