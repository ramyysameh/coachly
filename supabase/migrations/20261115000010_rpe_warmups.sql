-- Logger tools: RPE per set (with an optional coach target), warm-up sets inserted ahead of
-- working sets, and "last time" values that know which sets were warm-ups.

-- ───────────────────────── RPE ─────────────────────────
-- Rate of perceived exertion, 5–10 in half steps (10 = nothing left, 8 = two reps left).
alter table public.session_sets
  add column rpe numeric(3,1) check (rpe is null or (rpe between 5 and 10 and rpe * 2 = floor(rpe * 2)));
alter table public.plan_exercises
  add column target_rpe numeric(3,1) check (target_rpe is null or (target_rpe between 5 and 10 and target_rpe * 2 = floor(target_rpe * 2)));
-- Copied into the session like the other targets, so later plan edits don't change a logged workout.
alter table public.session_exercises
  add column target_rpe numeric(3,1) check (target_rpe is null or (target_rpe between 5 and 10 and target_rpe * 2 = floor(target_rpe * 2)));

-- copy_plan and start_session: as in 20261111000002, now carrying target_rpe.
create or replace function public.copy_plan(p_source uuid, p_name text, p_client uuid default null, p_start_date date default null)
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
    insert into public.plan_exercises (plan_day_id, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes, target_rpe)
    select v_new_day, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes, target_rpe
    from public.plan_exercises where plan_day_id = v_day.id;
  end loop;
  return v_new;
end $$;

create or replace function public.start_session(p_plan_day uuid, p_date date)
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
      target_sets, rep_min, rep_max, rest_seconds, coach_notes, target_rpe)
    values (v_session, v_pe.exercise_id, v_pe.position, v_pe.exercise_name, v_pe.is_bodyweight,
      v_pe.target_sets, v_pe.rep_min, v_pe.rep_max, v_pe.rest_seconds, v_pe.notes, v_pe.target_rpe)
    returning id into v_se;
    insert into public.session_sets (session_exercise_id, set_number)
    select v_se, n from generate_series(1, v_pe.target_sets) n;
  end loop;
  return v_session;
end $$;

-- ───────────────────────── last_performance with set types ─────────────────────────
-- Adds set_type so the logger can line warm-ups up with warm-ups and working sets with
-- working sets. The return type changes, so the function is dropped and recreated.
drop function public.last_performance(uuid);
create function public.last_performance(p_session uuid)
returns table (exercise_id uuid, performed_on date, set_number int, reps int, weight_kg numeric, set_type text)
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
  select l.exercise_id, l.scheduled_date, ss.set_number, ss.reps, ss.weight_kg, ss.set_type
  from latest l join public.session_sets ss on ss.session_exercise_id = l.se_id
  where ss.completed
  order by l.exercise_id, ss.set_number;
$$;
revoke execute on function public.last_performance(uuid) from public, anon;
grant execute on function public.last_performance(uuid) to authenticated;

-- ───────────────────────── Warm-up sets ─────────────────────────
-- Inserts warm-up sets ahead of an exercise's existing sets in one transaction.
-- p_sets: [{"weight_kg": 40, "reps": 10}, …] in order. Existing sets move down by the count.
-- security invoker: the session_sets policies decide whether the caller may write here.
create function public.add_warmup_sets(p_session_exercise uuid, p_sets jsonb)
returns setof public.session_sets
language plpgsql security invoker set search_path = '' as $$
declare
  n int := jsonb_array_length(p_sets);
begin
  if n < 1 or n > 6 then raise exception 'Add between 1 and 6 warm-up sets'; end if;
  if not public.session_exercise_access(p_session_exercise, true) then raise exception 'Workout not found'; end if;
  -- Two steps so the (session_exercise_id, set_number) unique index never sees a collision.
  update public.session_sets set set_number = set_number + 1000 where session_exercise_id = p_session_exercise;
  update public.session_sets set set_number = set_number - 1000 + n where session_exercise_id = p_session_exercise;
  insert into public.session_sets (session_exercise_id, set_number, weight_kg, reps, set_type)
  select p_session_exercise, ord::int, (e->>'weight_kg')::numeric, (e->>'reps')::int, 'warmup'
  from jsonb_array_elements(p_sets) with ordinality as t(e, ord);
  return query select * from public.session_sets where session_exercise_id = p_session_exercise order by set_number;
end $$;
revoke execute on function public.add_warmup_sets(uuid, jsonb) from public, anon;
grant execute on function public.add_warmup_sets(uuid, jsonb) to authenticated;
