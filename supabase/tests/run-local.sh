#!/usr/bin/env bash
# Disposable PostgreSQL logic test. Not a replacement for hosted Supabase tests.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="simple-grant-db-test-$$"
image='postgres:17-alpine@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac'
bucket_error_log="$(mktemp)"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$bucket_error_log"
}
trap cleanup EXIT
# No published ports, no persistent volume, and no network. Trust applies only
# inside this short-lived test container and is never a deployment instruction.
docker run --rm --network none --name "$container_name" -d \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  docker logs "$container_name"
  exit 1
fi
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < "$repo_root/supabase/tests/bootstrap-local.sql"
# A pre-existing public bucket must abort the whole migration, and must not be
# reconfigured or left exposing newly created application tables.
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('documents','documents',true,10485760,array['application/pdf','image/jpeg','image/png','image/webp','text/plain']);
SQL
if docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 \
  < "$repo_root/supabase/migrations/202611100001_initial.sql" > /dev/null 2> "$bucket_error_log"; then
  echo 'FAIL: migration accepted a pre-existing public documents bucket' >&2
  exit 1
fi
case "$(cat "$bucket_error_log")" in
  *'Existing documents bucket is incompatible'*) ;;
  *) cat "$bucket_error_log" >&2; exit 1 ;;
esac
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.organizations') is not null then
    raise exception 'Failed migration left application tables behind';
  end if;
  if not exists (select 1 from storage.buckets where id = 'documents' and public = true) then
    raise exception 'Failed migration modified the existing bucket';
  end if;
end;
$$;
delete from storage.buckets where id = 'documents';
select 'PASS: incompatible public bucket rejected, unchanged, and migration rolled back' as result;
SQL
for migration in "$repo_root"/supabase/migrations/*.sql; do
  docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
done
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < "$repo_root/supabase/tests/rls.sql"
