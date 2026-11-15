-- Workout structure: supersets, timed exercises (planks, carries) and adding or swapping an
-- exercise during a workout.

-- ───────────────────────── Timed exercises ─────────────────────────
-- A timed exercise logs a duration per set instead of reps. Its rep targets are read as seconds,
-- so the 1–100 range widens to 1–3600 (the app still keeps rep-based targets at 1–100).
alter table public.exercises add column timed boolean not null default false;
update public.exercises set timed = true where created_by is null and name in ('Plank', 'Farmer''s Carry');

alter table public.plan_exercises drop constraint plan_exercises_rep_min_check;
alter table public.plan_exercises drop constraint plan_exercises_rep_max_check;
alter table public.plan_exercises add constraint plan_exercises_rep_min_check check (rep_min between 1 and 3600);
alter table public.plan_exercises add constraint plan_exercises_rep_max_check check (rep_max between 1 and 3600);

alter table public.session_sets
  add column duration_s int check (duration_s is null or duration_s between 0 and 36000);

-- ───────────────────────── Supersets ─────────────────────────
-- Adjacent exercises in a day that share a group number are done back to back as a superset.
alter table public.plan_exercises add column superset_group smallint check (superset_group between 1 and 50);

-- Session snapshots: superset grouping and the timed flag are copied in like the other targets.
-- original_exercise_name is set when the client swaps an exercise; added_mid_workout when they add one.
alter table public.session_exercises
  add column superset_group smallint check (superset_group between 1 and 50),
  add column timed boolean not null default false,
  add column original_exercise_name text,
  add column added_mid_workout boolean not null default false;

-- copy_plan and start_session: as in 20261115000010, now carrying superset_group (and timed into sessions).
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
    insert into public.plan_exercises (plan_day_id, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes, target_rpe, superset_group)
    select v_new_day, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes, target_rpe, superset_group
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
    select pe.*, e.name as exercise_name, e.is_bodyweight, e.timed
    from public.plan_exercises pe join public.exercises e on e.id = pe.exercise_id
    where pe.plan_day_id = p_plan_day order by pe.position
  loop
    insert into public.session_exercises (session_id, exercise_id, position, exercise_name, is_bodyweight,
      target_sets, rep_min, rep_max, rest_seconds, coach_notes, target_rpe, superset_group, timed)
    values (v_session, v_pe.exercise_id, v_pe.position, v_pe.exercise_name, v_pe.is_bodyweight,
      v_pe.target_sets, v_pe.rep_min, v_pe.rep_max, v_pe.rest_seconds, v_pe.notes, v_pe.target_rpe,
      v_pe.superset_group, v_pe.timed)
    returning id into v_se;
    insert into public.session_sets (session_exercise_id, set_number)
    select v_se, n from generate_series(1, v_pe.target_sets) n;
  end loop;
  return v_session;
end $$;

-- last_performance: as in 20261115000010, plus duration_s for timed exercises.
drop function public.last_performance(uuid);
create function public.last_performance(p_session uuid)
returns table (exercise_id uuid, performed_on date, set_number int, reps int, weight_kg numeric, set_type text, duration_s int)
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
  select l.exercise_id, l.scheduled_date, ss.set_number, ss.reps, ss.weight_kg, ss.set_type, ss.duration_s
  from latest l join public.session_sets ss on ss.session_exercise_id = l.se_id
  where ss.completed
  order by l.exercise_id, ss.set_number;
$$;
revoke execute on function public.last_performance(uuid) from public, anon;
grant execute on function public.last_performance(uuid) to authenticated;

-- ───────────────────────── Changing a workout in progress ─────────────────────────
-- Adds an exercise to the end of the caller's own session with default targets and 3 sets.
create function public.add_session_exercise(p_session uuid, p_exercise uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_ex public.exercises;
  v_se uuid;
begin
  if not exists (select 1 from public.workout_sessions where id = p_session and client_id = auth.uid()) then
    raise exception 'Workout not found';
  end if;
  -- RLS limits this to built-in exercises and ones the caller can see.
  select * into v_ex from public.exercises where id = p_exercise;
  if not found then raise exception 'Exercise not found'; end if;

  insert into public.session_exercises (session_id, exercise_id, position, exercise_name, is_bodyweight, timed,
    target_sets, rep_min, rep_max, rest_seconds, added_mid_workout)
  values (p_session, v_ex.id,
    coalesce((select max(position) + 1 from public.session_exercises where session_id = p_session), 0),
    v_ex.name, v_ex.is_bodyweight, v_ex.timed, 3,
    case when v_ex.timed then 30 else 8 end, case when v_ex.timed then 60 else 12 end, 90, true)
  returning id into v_se;
  insert into public.session_sets (session_exercise_id, set_number) select v_se, n from generate_series(1, 3) n;
  return v_se;
end $$;

-- Swaps an exercise for another (busy machine, injury) before any of its sets are ticked off.
-- Targets and sets stay; typed-in values are cleared because they belonged to the old exercise.
create function public.swap_session_exercise(p_session_exercise uuid, p_exercise uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_ex public.exercises;
begin
  if not exists (
    select 1 from public.session_exercises se join public.workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise and s.client_id = auth.uid()
  ) then
    raise exception 'Workout not found';
  end if;
  if exists (select 1 from public.session_sets where session_exercise_id = p_session_exercise and completed) then
    raise exception 'Sets are already logged for this exercise, so it can no longer be swapped';
  end if;
  select * into v_ex from public.exercises where id = p_exercise;
  if not found then raise exception 'Exercise not found'; end if;

  update public.session_exercises
  set original_exercise_name = coalesce(original_exercise_name, exercise_name),
      exercise_id = v_ex.id, exercise_name = v_ex.name, is_bodyweight = v_ex.is_bodyweight, timed = v_ex.timed
  where id = p_session_exercise;
  -- Drop warm-ups and typed values: they were for the old exercise.
  delete from public.session_sets where session_exercise_id = p_session_exercise and set_type = 'warmup';
  update public.session_sets set weight_kg = null, reps = null, duration_s = null, rpe = null, set_type = 'normal'
  where session_exercise_id = p_session_exercise;
end $$;

revoke execute on function public.add_session_exercise(uuid, uuid) from public, anon;
grant execute on function public.add_session_exercise(uuid, uuid) to authenticated;
revoke execute on function public.swap_session_exercise(uuid, uuid) from public, anon;
grant execute on function public.swap_session_exercise(uuid, uuid) to authenticated;
