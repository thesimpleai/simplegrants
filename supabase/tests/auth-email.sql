-- Test-only auth email limit/lookup checks; every synthetic record is rolled back.
begin;
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000001','login-existing@example.invalid');
set local role service_role;
do $$
declare
  v_email text := encode(sha256(convert_to('rate-test-email','UTF8')),'hex');
  v_ip text := encode(sha256(convert_to('rate-test-ip','UTF8')),'hex');
  v_shared_ip text := encode(sha256(convert_to('shared-ip','UTF8')),'hex');
  v_id uuid;
  i integer;
begin
  if not simple_grant.auth_email_user_exists('LOGIN-EXISTING@example.invalid') then raise exception 'Existing case-insensitive login lookup failed'; end if;
  if simple_grant.auth_email_user_exists('missing@example.invalid') or simple_grant.auth_email_user_exists(null) then raise exception 'Unknown/null login lookup was true'; end if;
  v_id := simple_grant.claim_auth_email(v_email,v_ip);
  if v_id is null then raise exception 'First auth email claim failed'; end if;
  if simple_grant.claim_auth_email(v_email,v_ip) is not null then raise exception 'Email 60s cooldown bypassed'; end if;
  for i in 2..5 loop
    update simple_grant.auth_email_requests set claimed_at = claimed_at - interval '2 minutes' where email_hash = v_email;
    if simple_grant.claim_auth_email(v_email,v_ip) is null then raise exception 'Email hourly quota blocked early'; end if;
  end loop;
  update simple_grant.auth_email_requests set claimed_at = claimed_at - interval '2 minutes' where email_hash = v_email;
  if simple_grant.claim_auth_email(v_email,v_ip) is not null then raise exception 'Sixth rolling-hour email claim allowed'; end if;
  if (select count(*) from simple_grant.auth_email_requests where email_hash = v_email) <> 5 then raise exception 'Denied email claim wrote an event'; end if;
  -- Expired rolling-hour claims must no longer count.
  update simple_grant.auth_email_requests set claimed_at = claimed_at - interval '2 hours' where email_hash = v_email;
  if simple_grant.claim_auth_email(v_email,v_ip) is null then raise exception 'Expired email quota did not reset'; end if;
  for i in 1..20 loop
    if simple_grant.claim_auth_email(encode(sha256(convert_to('unique-email-'||i,'UTF8')),'hex'),v_shared_ip) is null then raise exception 'IP hourly quota blocked early'; end if;
  end loop;
  if simple_grant.claim_auth_email(encode(sha256(convert_to('unique-email-21','UTF8')),'hex'),v_shared_ip) is not null then raise exception '21st rolling-hour IP claim allowed'; end if;
  begin
    perform simple_grant.claim_auth_email('raw@example.invalid','192.0.2.1');
    raise exception 'Raw/non-HMAC input accepted';
  exception when invalid_parameter_value then null;
  end;
  insert into simple_grant.auth_email_requests(email_hash,ip_hash,claimed_at)
    select repeat('e',64),repeat('f',64),clock_timestamp()-interval '25 hours' from generate_series(1,1005);
  if simple_grant.claim_auth_email(repeat('a',64),repeat('b',64)) is null then raise exception 'Prune trigger claim failed'; end if;
  if (select count(*) from simple_grant.auth_email_requests where email_hash = repeat('e',64)) <> 805 then raise exception 'Old-event cleanup was not bounded to 200'; end if;
end;
$$;
reset role;
do $$
declare v_role text;
begin
  if (select count(*) from information_schema.columns where table_schema = 'simple_grant' and table_name = 'auth_email_requests') <> 4 then raise exception 'Unexpected rate table fields'; end if;
  foreach v_role in array array['anon','authenticated','legacy_app'] loop
    if has_table_privilege(v_role,'simple_grant.auth_email_requests','SELECT')
      or has_function_privilege(v_role,'simple_grant.claim_auth_email(text,text)','EXECUTE')
      or has_function_privilege(v_role,'simple_grant.auth_email_user_exists(text)','EXECUTE') then
      raise exception 'Client/custom role can read rate events or call service auth email RPC';
    end if;
  end loop;
end;
$$;
set local role authenticated;
do $$
begin
  begin
    perform simple_grant.auth_email_user_exists('login-existing@example.invalid');
    raise exception 'Authenticated user can enumerate account existence';
  exception when insufficient_privilege then null;
  end;
  begin
    perform simple_grant.claim_auth_email(repeat('a',64),repeat('b',64));
    raise exception 'Authenticated user can invoke service rate claim';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select 'PASS: service-only auth email lookup, HMAC-only events, cooldown/email/IP limits, expiry and bounded cleanup' as result;
rollback;
