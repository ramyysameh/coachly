-- Row level security. Every table is locked down; nothing is readable by anon.

alter table public.profiles enable row level security;
alter table public.coach_clients enable row level security;
alter table public.invitations enable row level security;
alter table public.exercises enable row level security;
alter table public.plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.plan_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.session_sets enable row level security;
alter table public.nutrition_targets enable row level security;
alter table public.meal_entries enable row level security;
alter table public.body_weights enable row level security;
alter table public.coach_notes enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

revoke all on all tables in schema public from anon;

-- ───── helpers for nested rows ─────
create function public.plan_access(p_plan uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan
      and (
        -- the owning coach, while the relationship (if any) is active for writes
        (p.coach_id = auth.uid() and (p.client_id is null or public.is_coach_of(p.client_id, p_write)))
        -- the client can read their own assigned plans
        or (not p_write and p.client_id = auth.uid())
      )
  );
$$;

create function public.plan_day_access(p_day uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_days d where d.id = p_day and public.plan_access(d.plan_id, p_write));
$$;

create function public.session_access(p_session uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workout_sessions s
    where s.id = p_session
      and (s.client_id = auth.uid() or (not p_write and public.is_coach_of(s.client_id)))
  );
$$;

create function public.session_exercise_access(p_se uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.session_exercises se where se.id = p_se and public.session_access(se.session_id, p_write));
$$;

-- ───── profiles ─────
create policy "read own, my clients, my coaches" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_coach_of(id) or public.is_client_of(id));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ───── relationships & invitations ─────
create policy "participants read relationship" on public.coach_clients for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());
-- inserts/updates only through accept_invitation() / set_client_status()

create policy "coach manages own invitations" on public.invitations for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and public.my_role() = 'coach');

-- ───── exercises ─────
create policy "read library" on public.exercises for select to authenticated
  using (created_by is null or created_by = auth.uid() or public.is_client_of(created_by));
create policy "coach adds custom exercises" on public.exercises for insert to authenticated
  with check (created_by = auth.uid() and public.my_role() = 'coach');
create policy "coach edits custom exercises" on public.exercises for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "coach deletes custom exercises" on public.exercises for delete to authenticated
  using (created_by = auth.uid());

-- ───── plans ─────
create policy "read plans" on public.plans for select to authenticated
  using (public.plan_access(id, false));
create policy "coach creates plans" on public.plans for insert to authenticated
  with check (coach_id = auth.uid() and public.my_role() = 'coach'
              and (client_id is null or public.is_coach_of(client_id, true)));
create policy "coach updates plans" on public.plans for update to authenticated
  using (public.plan_access(id, true))
  with check (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)));
create policy "coach deletes plans" on public.plans for delete to authenticated
  using (public.plan_access(id, true));

create policy "read plan days" on public.plan_days for select to authenticated
  using (public.plan_access(plan_id, false));
create policy "write plan days" on public.plan_days for all to authenticated
  using (public.plan_access(plan_id, true)) with check (public.plan_access(plan_id, true));

create policy "read plan exercises" on public.plan_exercises for select to authenticated
  using (public.plan_day_access(plan_day_id, false));
create policy "write plan exercises" on public.plan_exercises for all to authenticated
  using (public.plan_day_access(plan_day_id, true)) with check (public.plan_day_access(plan_day_id, true));

-- ───── workout logs (client writes, coach reads) ─────
create policy "read sessions" on public.workout_sessions for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "client writes sessions" on public.workout_sessions for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

create policy "read session exercises" on public.session_exercises for select to authenticated
  using (public.session_access(session_id, false));
create policy "client writes session exercises" on public.session_exercises for all to authenticated
  using (public.session_access(session_id, true)) with check (public.session_access(session_id, true));

create policy "read session sets" on public.session_sets for select to authenticated
  using (public.session_exercise_access(session_exercise_id, false));
create policy "client writes session sets" on public.session_sets for all to authenticated
  using (public.session_exercise_access(session_exercise_id, true))
  with check (public.session_exercise_access(session_exercise_id, true));

-- ───── nutrition ─────
create policy "read targets" on public.nutrition_targets for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "coach sets targets" on public.nutrition_targets for all to authenticated
  using (public.is_coach_of(client_id, true))
  with check (public.is_coach_of(client_id, true) and updated_by = auth.uid());

create policy "read meals" on public.meal_entries for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "client writes meals" on public.meal_entries for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

create policy "read body weight" on public.body_weights for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "client writes body weight" on public.body_weights for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- ───── private coach notes ─────
create policy "coach reads own notes" on public.coach_notes for select to authenticated
  using (coach_id = auth.uid() and public.is_coach_of(client_id));
create policy "coach writes own notes" on public.coach_notes for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and public.is_coach_of(client_id, true));

-- ───── messaging ─────
create policy "members read conversation" on public.conversations for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());

create policy "members read messages" on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "members send while active" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id, true));

create policy "own read markers" on public.conversation_reads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

-- Realtime: stream new messages (RLS still applies to subscribers).
alter publication supabase_realtime add table public.messages;

-- ───────────────────────── RPC functions ─────────────────────────

-- Public preview of an invite (safe to call before signing in).
create function public.get_invitation(p_token text)
returns table (coach_name text, expires_at timestamptz, status text)
language sql stable security definer set search_path = '' as $$
  select p.full_name, i.expires_at,
    case
      when i.revoked then 'revoked'
      when i.accepted_at is not null then 'used'
      when i.expires_at < now() then 'expired'
      else 'valid'
    end
  from public.invitations i join public.profiles p on p.id = i.coach_id
  where i.token = p_token;
$$;
grant execute on function public.get_invitation(text) to anon, authenticated;

create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_existing public.coach_clients;
  v_rel uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.my_role() <> 'client' then raise exception 'Only client accounts can accept invitations'; end if;

  select * into v_inv from public.invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found'; end if;
  if v_inv.revoked then raise exception 'This invitation was revoked'; end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = auth.uid() then
      select id into v_rel from public.coach_clients where coach_id = v_inv.coach_id and client_id = auth.uid() and status = 'active';
      if v_rel is not null then return v_rel; end if;
    end if;
    raise exception 'This invitation has already been used';
  end if;
  if v_inv.expires_at < now() then raise exception 'This invitation has expired'; end if;

  select * into v_existing from public.coach_clients where client_id = auth.uid() and status = 'active';
  if found then
    if v_existing.coach_id = v_inv.coach_id then
      v_rel := v_existing.id;
    else
      raise exception 'You already have an active coach. Ask them to archive the relationship first.';
    end if;
  else
    -- Reactivate an archived relationship with the same coach so history and chat carry over.
    update public.coach_clients set status = 'active', archived_at = null
      where id = (select id from public.coach_clients
                  where coach_id = v_inv.coach_id and client_id = auth.uid()
                  order by created_at desc limit 1)
      returning id into v_rel;
    if v_rel is null then
      insert into public.coach_clients (coach_id, client_id) values (v_inv.coach_id, auth.uid())
        returning id into v_rel;
    end if;
  end if;

  update public.invitations set accepted_by = auth.uid(), accepted_at = now() where id = v_inv.id;
  return v_rel;
end $$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Coach archives or restores a client relationship. Records are kept either way.
create function public.set_client_status(p_client uuid, p_status public.relationship_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rel uuid;
begin
  select id into v_rel from public.coach_clients
    where coach_id = auth.uid() and client_id = p_client
    order by created_at desc limit 1;
  if v_rel is null then raise exception 'Client not found'; end if;
  update public.coach_clients
    set status = p_status, archived_at = case when p_status = 'archived' then now() end
    where id = v_rel;
end $$;
revoke execute on function public.set_client_status(uuid, public.relationship_status) from public, anon;
grant execute on function public.set_client_status(uuid, public.relationship_status) to authenticated;

-- Deep-copies a plan. With p_client it becomes that client's active plan from p_start_date;
-- without, it becomes a new template.
create function public.copy_plan(p_source uuid, p_name text, p_client uuid default null, p_start_date date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.plans;
  v_new uuid;
  v_day record;
  v_new_day uuid;
begin
  select * into v_src from public.plans where id = p_source and coach_id = auth.uid();
  if not found then raise exception 'Plan not found'; end if;
  if p_client is not null then
    if not public.is_coach_of(p_client, true) then raise exception 'Not your client'; end if;
    if p_start_date is null then raise exception 'Start date is required'; end if;
    update public.plans set is_active = false where client_id = p_client and is_active;
  end if;

  insert into public.plans (coach_id, client_id, name, description, start_date, is_active, source_plan_id)
  values (auth.uid(), p_client, coalesce(nullif(trim(p_name), ''), v_src.name), v_src.description,
          p_start_date, p_client is not null, v_src.id)
  returning id into v_new;

  for v_day in select * from public.plan_days where plan_id = p_source order by position loop
    insert into public.plan_days (plan_id, position, name, weekdays)
    values (v_new, v_day.position, v_day.name, v_day.weekdays) returning id into v_new_day;
    insert into public.plan_exercises (plan_day_id, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes)
    select v_new_day, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes
    from public.plan_exercises where plan_day_id = v_day.id;
  end loop;
  return v_new;
end $$;

-- Client starts (or resumes) the session for a plan day on a date.
-- Targets are copied into the session so later plan edits don't change it.
create function public.start_session(p_plan_day uuid, p_date date)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_day record;
  v_session uuid;
  v_pe record;
  v_se uuid;
begin
  select d.id, d.name, p.id as plan_id, p.client_id into v_day
  from public.plan_days d join public.plans p on p.id = d.plan_id
  where d.id = p_plan_day;
  if not found or v_day.client_id is distinct from auth.uid() then
    raise exception 'Workout not found';
  end if;

  select id into v_session from public.workout_sessions
    where client_id = auth.uid() and plan_day_id = p_plan_day and scheduled_date = p_date;
  if v_session is not null then return v_session; end if;

  insert into public.workout_sessions (client_id, plan_id, plan_day_id, scheduled_date, name)
  values (auth.uid(), v_day.plan_id, p_plan_day, p_date, v_day.name)
  returning id into v_session;

  for v_pe in
    select pe.*, e.name as exercise_name, e.is_bodyweight
    from public.plan_exercises pe join public.exercises e on e.id = pe.exercise_id
    where pe.plan_day_id = p_plan_day order by pe.position
  loop
    insert into public.session_exercises (session_id, exercise_id, position, exercise_name, is_bodyweight,
      target_sets, rep_min, rep_max, rest_seconds, coach_notes)
    values (v_session, v_pe.exercise_id, v_pe.position, v_pe.exercise_name, v_pe.is_bodyweight,
      v_pe.target_sets, v_pe.rep_min, v_pe.rep_max, v_pe.rest_seconds, v_pe.notes)
    returning id into v_se;
    insert into public.session_sets (session_exercise_id, set_number)
    select v_se, n from generate_series(1, v_pe.target_sets) n;
  end loop;
  return v_session;
end $$;

-- Most recent logged sets for each exercise in a session, from earlier sessions.
create function public.last_performance(p_session uuid)
returns table (exercise_id uuid, performed_on date, set_number int, reps int, weight_kg numeric)
language sql stable security invoker set search_path = '' as $$
  with cur as (
    select s.client_id, s.started_at, se.exercise_id
    from public.workout_sessions s join public.session_exercises se on se.session_id = s.id
    where s.id = p_session and se.exercise_id is not null
  ),
  latest as (
    select distinct on (se.exercise_id) se.exercise_id, se.id as se_id, s.scheduled_date
    from cur
    join public.session_exercises se on se.exercise_id = cur.exercise_id
    join public.workout_sessions s on s.id = se.session_id
    where s.client_id = cur.client_id and s.id <> p_session and s.started_at < cur.started_at
      and exists (select 1 from public.session_sets ss where ss.session_exercise_id = se.id and ss.completed)
    order by se.exercise_id, s.started_at desc
  )
  select l.exercise_id, l.scheduled_date, ss.set_number, ss.reps, ss.weight_kg
  from latest l join public.session_sets ss on ss.session_exercise_id = l.se_id
  where ss.completed
  order by l.exercise_id, ss.set_number;
$$;

-- Per-session best set for one exercise (for progress charts).
create function public.exercise_history(p_client uuid, p_exercise uuid)
returns table (performed_on date, top_weight_kg numeric, top_reps int, total_reps bigint, volume_kg numeric)
language sql stable security invoker set search_path = '' as $$
  select s.scheduled_date,
    max(ss.weight_kg),
    max(ss.reps),
    sum(ss.reps),
    sum(coalesce(ss.weight_kg, 0) * coalesce(ss.reps, 0))
  from public.workout_sessions s
  join public.session_exercises se on se.session_id = s.id
  join public.session_sets ss on ss.session_exercise_id = se.id
  where s.client_id = p_client and se.exercise_id = p_exercise and ss.completed
  group by s.id, s.scheduled_date
  order by s.scheduled_date;
$$;

-- Exercises a client has logged at least once.
create function public.logged_exercises(p_client uuid)
returns table (exercise_id uuid, name text, is_bodyweight boolean, sessions bigint)
language sql stable security invoker set search_path = '' as $$
  select se.exercise_id, max(se.exercise_name), bool_or(se.is_bodyweight), count(distinct s.id)
  from public.workout_sessions s
  join public.session_exercises se on se.session_id = s.id
  where s.client_id = p_client and se.exercise_id is not null
    and exists (select 1 from public.session_sets ss where ss.session_exercise_id = se.id and ss.completed)
  group by se.exercise_id
  order by 4 desc, 2;
$$;

-- Scheduled workouts between start and end that have no completed session.
create function public.missed_sessions(p_client uuid, p_from date, p_to date)
returns table (scheduled_date date, plan_day_id uuid, day_name text)
language sql stable security invoker set search_path = '' as $$
  select g::date, d.id, d.name
  from public.plans p
  join public.plan_days d on d.plan_id = p.id
  cross join lateral generate_series(greatest(p_from, p.start_date), p_to, interval '1 day') g
  where p.client_id = p_client and p.is_active
    and extract(isodow from g)::smallint = any (d.weekdays)
    and not exists (
      select 1 from public.workout_sessions s
      where s.client_id = p_client and s.plan_day_id = d.id
        and s.scheduled_date = g::date and s.status = 'completed'
    )
  order by 1;
$$;

-- Unread message counts for the current user.
create function public.unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql stable security invoker set search_path = '' as $$
  select c.id, count(m.id)
  from public.conversations c
  left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join public.messages m on m.conversation_id = c.id
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where auth.uid() in (c.coach_id, c.client_id)
  group by c.id;
$$;

create function public.mark_conversation_read(p_conversation uuid)
returns void language sql security invoker set search_path = '' as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
$$;

-- Lock all functions to signed-in users (get_invitation stays public).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('copy_plan','start_session','last_performance','exercise_history','logged_exercises',
       'missed_sessions','unread_counts','mark_conversation_read','is_coach_of','is_client_of','my_role',
       'plan_access','plan_day_access','session_access','session_exercise_access','is_conversation_member')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
