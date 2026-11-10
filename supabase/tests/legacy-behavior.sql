-- Synthetic legacy-app behavior smoke; run before AND after SG installation.
begin;
select set_config('request.jwt.claim.sub','',true);
do $$
declare v_role text; v_rows integer;
begin
  foreach v_role in array array['authenticated','anon','legacy_app'] loop
    execute format('set local role %I',v_role);
    if (select count(*) from storage.objects where bucket_id = 'pdfs') <> 1 then
      raise exception 'Legacy pdfs read changed for %',v_role;
    end if;
    if exists (select 1 from storage.objects where bucket_id = 'finance-evidence') then
      raise exception 'Existing finance restriction bypassed for %',v_role;
    end if;
    insert into storage.objects(bucket_id,name) values ('pdfs','legacy-smoke.pdf');
    update storage.objects set name = 'legacy-smoke-renamed.pdf' where bucket_id = 'pdfs' and name = 'legacy-smoke.pdf';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Legacy update changed for %',v_role; end if;
    delete from storage.objects where bucket_id = 'pdfs' and name = 'legacy-smoke-renamed.pdf';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Legacy delete changed for %',v_role; end if;
    begin
      insert into storage.objects(bucket_id,name) values ('finance-evidence','must-remain-blocked.pdf');
      raise exception 'Existing finance upload restriction bypassed for %',v_role;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
end;
$$;
do $$
begin
  if (select title from public.documents where id = '90000000-0000-4000-8000-000000000001') <> 'Existing app evidence: must stay unchanged'
    or (select count(*) from public.documents) <> 1 then raise exception 'Existing public.documents changed'; end if;
  if not has_table_privilege('legacy_app','public.default_acl_sentinel','SELECT') then raise exception 'Existing default-granted access changed'; end if;
  if public.create_organization('existing','app') <> 'existing app function preserved' then raise exception 'Existing public function changed'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000000' and name = 'existing_other_app')
    or (select count(*) from supabase_migrations.schema_migrations) <> 1 then raise exception 'Existing migration history changed'; end if;
end;
$$;
select 'PASS: legacy authenticated, anon and custom-role storage behavior and public documents/history unchanged' as result;
rollback;
