# Shared-project database security regression

Run `bash supabase/tests/run-local.sh` from a machine with Node and Docker. The default command runs three independent scenarios in fresh, network-isolated PostgreSQL 17 containers: adversarial legacy policies/default ACLs, the three exact Storage policy definitions supplied for the shared project, and a 005-only upgrade of an existing 001–004 installation. All load minimal Supabase `auth.uid()`/`auth.role()` JWT-claim stubs. Fresh-install cases run the exact generated `supabase/install-simple-grant.sql`; the upgrade case builds baselines 001–004 and then applies the standalone 005 file. It checks `node supabase/build-installer.mjs --check` first. The official image is pinned to the development manifest digest. Any SQL error or failed assertion fails the run; the container and temporary files are removed on exit.

**All files under this tests directory are test scaffolding. Never run them against a live/shared Supabase project.** They create synthetic records and global-default-ACL stress fixtures only inside the disposable local container. They do not implement Supabase Auth, Storage API validation, email delivery, or the PostgREST exposed-schema setting.

The adversarial shared fixture contains an existing `public.documents` row, colliding public functions, prior CLI history, private `finance-evidence` and public `pdfs` buckets, broad permissive policies for every role, a finance-specific restrictive policy, and global default grants to anonymous/authenticated/custom roles. The installer must preserve all existing metadata, synthetic legacy records and allowed/denied storage behavior. `shared-project-common.sql` supplies the common unrelated objects; the policy-specific files are separate so the exact-policy scenario contains no broad-policy or global-default-ACL stress additions.

Run just one scenario with `bash supabase/tests/run-local.sh --adversarial`, `--hosted-policies`, or `--upgrade-auth-email`.

The exact-policy fixture preserves the quoted policy names and predicates:

- `"Allow authenticated downloads"`: permissive authenticated SELECT, `bucket_id = 'pdfs' AND auth.role() = 'authenticated'`.
- `"Allow authenticated uploads"`: permissive authenticated INSERT with the same predicate.
- `finance_evidence_server_only`: restrictive ALL for anon/authenticated, `bucket_id <> 'finance-evidence'` for USING and WITH CHECK.

The before/after exact-policy checks establish that authenticated PDF SELECT/INSERT remain allowed, PDF UPDATE/DELETE remain denied, mismatched JWT role is denied, anonymous SQL access remains denied, and finance SELECT/INSERT/UPDATE/DELETE stay denied to anon/authenticated while service-role bypass remains. Public-bucket HTTP downloads are a different Storage API behavior and are not exercised by these SQL tests.

All scenarios verify:

- Generated installer matches all five canonical baselines. Fresh installations run atomically; 005 is an atomic separate upgrade for existing installations.
- An incompatible public `simple-grant-documents` bucket causes a full rollback without modifying that bucket. An existing `simple_grant` schema fails safely on reinstall.
- Unrelated public/auth/storage/history metadata fingerprint and object count remain unchanged. Existing global default ACLs are not modified.
- Legacy permissions are preserved for each fixture: broad authenticated/anonymous/custom-role CRUD in the adversarial case, and authenticated-only PDF SELECT/INSERT with denied UPDATE/DELETE in the exact-policy case. Finance restrictions remain enforced.
- All 13 Simple Grant tables are in `simple_grant`, have RLS and no anonymous table access. New storage has four permissive and four restrictive policies.
- Organisation-owner creation, input validation, tenant/relationship isolation, immutable tenant linkage, viewer read/no-write access and no membership escalation.
- Broad existing permissive policies cannot expose Simple Grant objects to anonymous users or another organisation through a custom role; object insert/update/delete and cross-bucket moves remain restricted.
- Inherited custom-role schema CREATE/table/service-RPC grants are stripped only on new Simple Grant objects. Safe public helper execution remains available for legacy policy evaluation.
- Job idempotency, retries and service-only access; durable per-user quotas shared across organisations and portal/email channels; unauthorised action and counter-tampering rejection.

`supabase/verify-shared-project.sql` is the separate read-only hosted check. Save its output before installing and compare the unrelated metadata fingerprint after. This does not read user/application records, does not prove unchanged record contents, and cannot replace hosted Auth/Storage/API tests. The supplied finance predicate is compatible with the new bucket and passes the local exact-definition regression. This is a PostgreSQL policy-logic result, not a hosted Auth/Storage/API verification. Additional policies added later may change access; do not remove or loosen other applications' rules.

The 005-only scenario constructs the original 001–004 schema in a fresh fixture, inserts a synthetic existing organisation, applies only the real 005 file and proves the organisation survives. It never reruns the initial installer over an existing schema.

Auth-email checks assert service-only account lookup, case-insensitive matching without client enumeration, hash-only request fields, 60-second cooldown, 5/email/hour, 20/IP/hour, rolling-window expiry and bounded 200-row pruning. Separate concurrent PostgreSQL sessions prove one accepted claim among 12 distinct-IP requests for one email and 20 accepted among 25 distinct-email requests for one IP. Custom snapshot isolation is rejected rather than trusting stale counters. No raw email/IP is persisted in the app's rate table, and inherited custom-role grants on 005 objects are removed without changing shared defaults.
