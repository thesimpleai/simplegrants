-- Test-only future unknown type and explicit approved type preservation.
begin;
insert into auth.users(id,email) values ('50000000-0000-4000-8000-000000000007','organisation-type-test@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000007',true);
do $$
declare v_org simple_grant.organizations;
begin
  select * into v_org from simple_grant.create_organization('New type unknown','never');
  if v_org.type is distinct from '' then raise exception 'New organisation made an unsupported type assertion'; end if;
  update simple_grant.organizations set type='Charity' where id=v_org.id;
  if (select type from simple_grant.organizations where id=v_org.id) <> 'Charity' then raise exception 'Explicit reviewed Charity type could not be saved'; end if;
end;
$$;
reset role;
select 'PASS: future RPC-created organisations start with unknown type; explicit reviewed Charity remains supported' as result;
rollback;
