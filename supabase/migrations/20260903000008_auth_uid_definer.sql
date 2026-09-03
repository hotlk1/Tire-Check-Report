-- app.auth_uid() reads Supabase's auth.uid() (the JWT subject) for the
-- PostgREST access path. The application role `app_user` has no privileges on
-- the `auth` schema, so evaluating a policy such as users_read as app_user
-- failed with "permission denied for schema auth" whenever the first
-- (security definer) branch of the policy was false. Run the helper as its
-- owner instead; it only returns the current JWT's user id.
create or replace function app.auth_uid() returns uuid
language plpgsql stable security definer set search_path = app, pg_temp as $$
begin
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    return (select auth.uid());
  end if;
  return null;
end;
$$;
grant execute on function app.auth_uid() to app_user;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.auth_uid() to authenticated;
  end if;
end $$;
