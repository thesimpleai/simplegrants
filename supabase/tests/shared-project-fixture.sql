-- Adversarial test-only policies/default ACLs; common fixture is loaded first.
-- Deliberately broader than known hosted policies, to test the strongest OR leak.
create policy legacy_broad_select on storage.objects for select to public using (true);
create policy legacy_broad_insert on storage.objects for insert to public with check (true);
create policy legacy_broad_update on storage.objects for update to public using (true) with check (true);
create policy legacy_broad_delete on storage.objects for delete to public using (true);
-- A representative existing restrictive policy that fences only its own bucket.
-- Actual hosted expressions remain unverified and may legitimately block SG.
create policy finance_evidence_server_only on storage.objects as restrictive for all to public
 using (bucket_id is distinct from 'finance-evidence' or current_user = 'service_role')
 with check (bucket_id is distinct from 'finance-evidence' or current_user = 'service_role');

-- Existing global defaults must remain intact but cannot leak onto SG objects.
alter default privileges grant all on tables to anon, authenticated, legacy_app;
alter default privileges grant execute on functions to anon, authenticated, legacy_app;
alter default privileges grant all on schemas to legacy_app;
create table public.default_acl_sentinel(id integer primary key);
insert into public.default_acl_sentinel values (1);
