-- Hygiene from the audit.
--
-- 1) Signed-out users (anon) get no table access and no RPCs except get_invitation.
--    Migration 002 revoked anon from the tables that existed then; tables and functions
--    added later kept Supabase's default grants. Row level security already hides every
--    row from anon, so nothing was readable: this is the backup in case a policy is ever wrong.
-- 2) forget_push_endpoints only removes devices of the caller or of people they are
--    connected to (their coach or client), not any endpoint anyone knows.

-- ───────────────────────── 1) anon ─────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Tables and sequences created by later migrations start without anon access too.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Functions are executable through PUBLIC by default. Take that away from every function
-- in public except trigger functions (never called directly) and get_invitation (the
-- signed-out invite page needs it), and give signed-in users explicit access instead.
-- clear_previous_coach_plans stays closed to everyone (it only runs as a trigger).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.proname <> 'get_invitation'
      -- leave extension functions (e.g. pgcrypto installed into public locally) alone
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ───────────────────────── 2) push endpoints ─────────────────────────
create or replace function public.forget_push_endpoints(p_endpoints text[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions ps
  where ps.endpoint = any (p_endpoints)
    and (
      ps.user_id = auth.uid()
      or exists (
        select 1 from public.coach_clients cc
        where cc.status = 'active'
          and ((cc.coach_id = auth.uid() and cc.client_id = ps.user_id)
            or (cc.client_id = auth.uid() and cc.coach_id = ps.user_id))
      )
    );
$$;
