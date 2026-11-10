#!/usr/bin/env bash
# Disposable shared-project PostgreSQL test; no hosted credentials or networking.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The default command executes BOTH isolated policy scenarios. Each child run
# gets a new PostgreSQL container, so role/cluster setup cannot leak between them.
if [ "$#" -eq 0 ]; then
  bash "$0" --adversarial
  bash "$0" --hosted-policies
  exit
fi
case "$1" in
  --adversarial)
    policy_fixture='shared-project-fixture.sql'
    legacy_checks='legacy-behavior.sql'
    ;;
  --hosted-policies)
    policy_fixture='hosted-policy-fixture.sql'
    legacy_checks='hosted-policy-behavior.sql'
    ;;
  *) echo 'Usage: run-local.sh [--adversarial|--hosted-policies]' >&2; exit 2 ;;
esac
printf 'Database scenario: %s\n' "$1"
node "$repo_root/supabase/build-installer.mjs" --check
container_name="simple-grant-db-test-$$"
image='postgres:17-alpine@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac'
test_dir="$(mktemp -d)"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT
# No published ports, persistent volume or network. Trust exists only in the
# isolated disposable test container and is never a deployment instruction.
docker run --rm --network none --name "$container_name" -d \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$container_name" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker logs "$container_name"; exit 1; fi
run_sql() { docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < "$1"; }
run_sql "$repo_root/supabase/tests/bootstrap-local.sql"
run_sql "$repo_root/supabase/tests/shared-project-common.sql"
run_sql "$repo_root/supabase/tests/$policy_fixture"
run_sql "$repo_root/supabase/tests/$legacy_checks"
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -tA \
  < "$repo_root/supabase/verify-shared-project.sql" > "$test_dir/before.json"
# Prove an incompatible existing SG bucket aborts the WHOLE combined installer.
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('simple-grant-documents','simple-grant-documents',true,10485760,array['application/pdf','image/jpeg','image/png','image/webp','text/plain']);
SQL
if run_sql "$repo_root/supabase/install-simple-grant.sql" > /dev/null 2> "$test_dir/bucket-error.log"; then
  echo 'FAIL: installer accepted a pre-existing public SG bucket' >&2; exit 1
fi
case "$(cat "$test_dir/bucket-error.log")" in
  *'Existing simple-grant-documents bucket is incompatible'*) ;;
  *) cat "$test_dir/bucket-error.log" >&2; exit 1 ;;
esac
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regnamespace('simple_grant') is not null then raise exception 'Failed installer left SG schema behind'; end if;
  if not exists (select 1 from storage.buckets where id = 'simple-grant-documents' and public = true) then
    raise exception 'Failed installer modified existing bucket';
  end if;
end;
$$;
delete from storage.buckets where id = 'simple-grant-documents';
select 'PASS: incompatible SG bucket rejected unchanged; entire installer rolled back' as result;
SQL
run_sql "$repo_root/supabase/install-simple-grant.sql"
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -tA \
  < "$repo_root/supabase/verify-shared-project.sql" > "$test_dir/after.json"
node --input-type=module - "$test_dir/before.json" "$test_dir/after.json" <<'JS'
import {readFileSync} from 'node:fs';
const [before, after] = process.argv.slice(2).map((path)=>JSON.parse(readFileSync(path,'utf8')));
if (before.unrelated_metadata_fingerprint !== after.unrelated_metadata_fingerprint || before.unrelated_object_count !== after.unrelated_object_count) throw new Error('Unrelated application metadata changed');
if (!after.simple_grant_schema_exists || after.simple_grant_tables.length !== 12 || after.simple_grant_tables.some((table)=>!table.rls || table.anon_select)) throw new Error('Expected isolated RLS tables not found');
if (after.simple_grant_bucket?.public !== false) throw new Error('SG bucket is not private');
if (after.storage_policies.filter((policy)=>policy.name.startsWith('simple_grant_documents_')).length !== 8) throw new Error('Expected eight SG storage policies');
process.stdout.write('PASS: unrelated public/auth/storage/history metadata fingerprint unchanged; 12 SG RLS tables, private bucket, eight SG storage policies.\n');
JS
# Reapplying an already-installed baseline must fail; never drop/reset to force it.
if run_sql "$repo_root/supabase/install-simple-grant.sql" > /dev/null 2> "$test_dir/reinstall-error.log"; then
  echo 'FAIL: existing SG schema was silently reused' >&2; exit 1
fi
case "$(cat "$test_dir/reinstall-error.log")" in
  *'schema "simple_grant" already exists'*) ;;
  *) cat "$test_dir/reinstall-error.log" >&2; exit 1 ;;
esac
run_sql "$repo_root/supabase/tests/$legacy_checks"
run_sql "$repo_root/supabase/tests/rls.sql"
