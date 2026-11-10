# Shared-project database security regression

Run `bash supabase/tests/run-local.sh` from a machine with Node and Docker. It creates a disposable, network-isolated PostgreSQL 17 container, loads minimal Supabase stubs and a representative existing-app fixture, and runs the exact generated `supabase/install-simple-grant.sql`. It checks `node supabase/build-installer.mjs --check` first. The official image is pinned to the development manifest digest. Any SQL error or failed assertion fails the run; the container and temporary files are removed on exit.

**All files under this tests directory are test scaffolding. Never run them against a live/shared Supabase project.** They create synthetic records and global-default-ACL stress fixtures only inside the disposable local container. They do not implement Supabase Auth, Storage API validation, email delivery, or the PostgREST exposed-schema setting.

The shared fixture contains an existing `public.documents` row, colliding public functions, prior CLI history, private `finance-evidence` and public `pdfs` buckets, broad permissive policies for every role, a finance-specific restrictive policy, and global default grants to anonymous/authenticated/custom roles. The installer must preserve all existing metadata, synthetic legacy records and allowed/denied storage behavior.

The suite verifies:

- Generated installer matches all four canonical baselines and runs atomically.
- An incompatible public `simple-grant-documents` bucket causes a full rollback without modifying that bucket. An existing `simple_grant` schema fails safely on reinstall.
- Unrelated public/auth/storage/history metadata fingerprint and object count remain unchanged. Existing global default ACLs are not modified.
- Legacy authenticated, anonymous and custom-role CRUD on the public bucket remains allowed, and existing finance restrictions remain enforced.
- All 12 Simple Grant tables are in `simple_grant`, have RLS and no anonymous table access. New storage has four permissive and four restrictive policies.
- Organisation-owner creation, input validation, tenant/relationship isolation, immutable tenant linkage, viewer read/no-write access and no membership escalation.
- Broad existing permissive policies cannot expose Simple Grant objects to anonymous users or another organisation through a custom role; object insert/update/delete and cross-bucket moves remain restricted.
- Inherited custom-role schema CREATE/table/service-RPC grants are stripped only on new Simple Grant objects. Safe public helper execution remains available for legacy policy evaluation.
- Job idempotency, retries and service-only access; durable per-user quotas shared across organisations and portal/email channels; unauthorised action and counter-tampering rejection.

`supabase/verify-shared-project.sql` is the separate read-only hosted check. Save its output before installing and compare the unrelated metadata fingerprint after. This does not read user/application records, does not prove unchanged record contents, and cannot replace hosted Auth/Storage/API tests. Unknown existing restrictive policy expressions may still block the new bucket and must be reviewed without removing or loosening other applications' rules.
