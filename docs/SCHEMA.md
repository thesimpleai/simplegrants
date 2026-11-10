# Supabase data model

Apply the SQL files in `supabase/migrations/` in filename order to a new Supabase project using the SQL editor, or link the Supabase CLI and run `supabase db push`. This migration targets Supabase Postgres with its existing `auth` and `storage` schemas. It does not provision an external project or insert demonstration data. Back up an existing database and review collisions before applying it to a project containing other applications.

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
- `documents`: private evidence metadata. Object paths start with the organisation UUID. PDF, PNG, JPEG, WEBP and plain text are allowed, with a 10 MiB bucket limit. The application may enforce a lower transfer or AI processing limit. Files are not public. If a pre-existing `documents` bucket is public or its MIME/file-size settings differ, the migration fails and rolls back rather than reusing or modifying it. Use a dedicated Supabase project or resolve that naming conflict before retrying.
- `opportunities`: source URL, provenance, known opening and closing times, guidelines, eligibility requirements and estimated match score. Unknown values remain null. Source provenance does not prove eligibility.
- `applications`: original opportunity, project information, AI-assisted draft, review/submission status and the external submission reference. A status change is not an automated funder submission.
- `funded_projects`: accepted funding, original proposal, budget JSON, milestones, reporting date and persisted `report_draft` JSON object. Draft reports remain subject to human review and external submission.
- `expenses`: non-negative expenditure and optional evidence document, attached to a funded project.
- `inbox_messages`: inbound communications and attachment metadata, requiring review before affecting a budget or grant record.
- `activity_log`: server-authored event history, visible to organisation members. Clients cannot forge log entries.

Every dependent record carries `org_id`. Composite foreign keys enforce that an application's opportunity, project's application, expense's project/document, and inbox message's project belong to that same organisation. Triggers prevent changing an existing record's organisation. Membership helper functions are `SECURITY DEFINER` with fully qualified references and empty `search_path` to avoid recursive RLS and object-shadowing attacks.

Private Storage policies separately enforce membership for the first path component. They do not trust client-supplied document metadata. Signed URLs, if created, are temporary bearer access and should not be emailed or logged.

## Service-only processing

`notification_runs` has a unique `(org_id, period_key)`. `claim_notification_run(p_org_id, p_period_key)` atomically claims a new, failed, or stale processing run. Columns are `id`, `org_id`, `period_key`, `status` (`processing`, `sent`, `failed`), `last_error`, `provider_message_id`, `started_at`, and `completed_at`.

`webhook_events` uses the provider `event_id` as its primary key. `claim_webhook_event(p_event_id, p_event_type)` atomically claims new, failed, or stale processing deliveries. Columns are `event_id`, `event_type`, `status` (`processing`, `processed`, `rejected`, `failed`), optional `org_id`, `received_at`, `processed_at`, and `last_error`.

Both claim functions and both tables are service-role only. A processing lease is reclaimable after 15 minutes; completed or rejected events cannot be reclaimed. Providers and workers must also use deterministic email idempotency keys, and attachment storage should use deterministic object paths, because database claiming cannot alone guarantee exactly-once external delivery. Never mark a notification `sent` until the email provider accepts it. Do not put sensitive request bodies, API keys or document contents into error metadata.

## Deployment verification

The migration was applied successfully to a disposable Postgres 17 instance with minimal `auth` and `storage` schema stubs. The SQL regression script passed organisation ownership, tenant isolation, cross-tenant foreign-key rejection, viewer restrictions, private-storage policies, immutable organisation linkage, membership escalation rejection, and job idempotency. This validates database logic, not the hosted Supabase Auth, Storage API or browser integration. The migration must also be executed and RLS exercised against the actual Supabase project before live use. Without configured Supabase credentials, generated types and UI builds cannot establish that database or storage policies work. A repeatable SQL security regression script is provided separately in `supabase/tests/rls.sql`; run it on a disposable Supabase database after applying the migration. It runs inside a rollback transaction.

## Durable AI request budget

`ai_usage` is a service-only table keyed by `(user_id, usage_date)`. Authenticated callers execute `claim_ai_request(p_org_id, p_action)` immediately before a billable AI operation. The function requires membership, and requires owner/admin/member editing privileges for every action except `ask`. Only `profile`, `discover`, `import-grant`, `draft`, `ask`, and `report` are accepted. An atomic conditional upsert enforces at most 60 user-initiated requests per user per UTC calendar day across all their organisations. Calls above the limit return `false`; unauthorised or invalid actions raise an error. Clients cannot read, alter, or reset the counter. Failed downstream operations still consume a claimed request; a three-stage profile extraction consumes one request, not three. This is an application guardrail, not a provider billing limit or global organisation quota; scheduled service jobs require their separate scheduler bounds.

`claim_email_ai_request(p_org_id, p_user_id)` is a service-role-only counterpart for the optional public-only inbound email reply worker. It verifies the explicitly supplied user's organisation membership, then atomically consumes the same user/UTC-day counter. It cannot be executed by authenticated or anonymous clients. Portal and email requests together are capped at 60 per user per day. The webhook must verify its provider signature and sender membership before calling this helper; the helper does not establish email authenticity or authorise access to private documents.
