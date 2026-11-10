# Shared-project database security regression

Run `bash supabase/tests/run-local.sh` from a machine with Node and Docker. The default command runs two independent scenarios in fresh, network-isolated PostgreSQL 17 containers: adversarial legacy policies/default ACLs, then the three exact Storage policy definitions supplied for the shared project. Both load minimal Supabase `auth.uid()`/`auth.role()` JWT-claim stubs and run the exact generated `supabase/install-simple-grant.sql`. It checks `node supabase/build-installer.mjs --check` first. The official image is pinned to the development manifest digest. Any SQL error or failed assertion fails the run; the container and temporary files are removed on exit.

**All files under this tests directory are test scaffolding. Never run them against a live/shared Supabase project.** They create synthetic records and global-default-ACL stress fixtures only inside the disposable local container. They do not implement Supabase Auth, Storage API validation, email delivery, or the PostgREST exposed-schema setting.

The adversarial shared fixture contains an existing `public.documents` row, colliding public functions, prior CLI history, private `finance-evidence` and public `pdfs` buckets, broad permissive policies for every role, a finance-specific restrictive policy, and global default grants to anonymous/authenticated/custom roles. The installer must preserve all existing metadata, synthetic legacy records and allowed/denied storage behavior. `shared-project-common.sql` supplies the common unrelated objects; the policy-specific files are separate so the exact-policy scenario contains no broad-policy or global-default-ACL stress additions.

Run just one scenario with `bash supabase/tests/run-local.sh --adversarial` or `--hosted-policies`.

The exact-policy fixture preserves the quoted policy names and predicates:

- `"Allow authenticated downloads"`: permissive authenticated SELECT, `bucket_id = 'pdfs' AND auth.role() = 'authenticated'`.
- `"Allow authenticated uploads"`: permissive authenticated INSERT with the same predicate.
- `finance_evidence_server_only`: restrictive ALL for anon/authenticated, `bucket_id <> 'finance-evidence'` for USING and WITH CHECK.

The before/after exact-policy checks establish that authenticated PDF SELECT/INSERT remain allowed, PDF UPDATE/DELETE remain denied, mismatched JWT role is denied, anonymous SQL access remains denied, and finance SELECT/INSERT/UPDATE/DELETE stay denied to anon/authenticated while service-role bypass remains. Public-bucket HTTP downloads are a different Storage API behavior and are not exercised by these SQL tests.

Both scenarios verify:

- Generated installer matches all four canonical baselines and runs atomically.
- An incompatible public `simple-grant-documents` bucket causes a full rollback without modifying that bucket. An existing `simple_grant` schema fails safely on reinstall.
- Unrelated public/auth/storage/history metadata fingerprint and object count remain unchanged. Existing global default ACLs are not modified.
- Legacy authenticated, anonymous and custom-role CRUD on the public bucket remains allowed, and existing finance restrictions remain enforced.
- All 12 Simple Grant tables are in `simple_grant`, have RLS and no anonymous table access. New storage has four permissive and four restrictive policies.
- Organisation-owner creation, input validation, tenant/relationship isolation, immutable tenant linkage, viewer read/no-write access and no membership escalation.
- Broad existing permissive policies cannot expose Simple Grant objects to anonymous users or another organisation through a custom role; object insert/update/delete and cross-bucket moves remain restricted.
- Inherited custom-role schema CREATE/table/service-RPC grants are stripped only on new Simple Grant objects. Safe public helper execution remains available for legacy policy evaluation.
- Job idempotency, retries and service-only access; durable per-user quotas shared across organisations and portal/email channels; unauthorised action and counter-tampering rejection.

`supabase/verify-shared-project.sql` is the separate read-only hosted check. Save its output before installing and compare the unrelated metadata fingerprint after. This does not read user/application records, does not prove unchanged record contents, and cannot replace hosted Auth/Storage/API tests. The supplied finance predicate is compatible with the new bucket and passes the local exact-definition regression. This is a PostgreSQL policy-logic result, not a hosted Auth/Storage/API verification. Additional policies added later may change access; do not remove or loosen other applications' rules.
