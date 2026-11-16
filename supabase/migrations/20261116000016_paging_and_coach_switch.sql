-- 1) Stable paging for the set history RPCs.
--    The API returns at most 1000 rows per request, so the app now pages through these
--    functions with .range(). Paging needs a total order; the old ORDER BY could tie
--    (two exercises at the same position), so ids are added as final tie-breakers.
--    Columns and filters are unchanged from 20261115000009.

create or replace function public.completed_sets(p_client uuid, p_from date, p_to date)
returns table (
  session_id uuid, performed_on date, session_name text,
  exercise_id uuid, exercise_name text, movement_id uuid, movement_name text, is_bodyweight boolean,
  set_number int, weight_kg numeric, reps int,
  primary_muscles text[], secondary_muscles text[]
)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.scheduled_date, s.name,
         se.exercise_id, se.exercise_name, e.movement_id, m.name, se.is_bodyweight,
         ss.set_number, ss.weight_kg, ss.reps,
         coalesce(e.primary_muscles, '{}'), coalesce(e.secondary_muscles, '{}')
  from public.workout_sessions s
  join public.session_exercises se on se.session_id = s.id
  join public.session_sets ss on ss.session_exercise_id = se.id
  left join public.exercises e on e.id = se.exercise_id
  left join public.movements m on m.id = e.movement_id
  where s.client_id = p_client
    and s.scheduled_date between p_from and p_to
    and ss.completed
    and ss.set_type <> 'warmup'
  order by s.scheduled_date, s.started_at, s.id, se.position, se.id, ss.set_number, ss.id;
$$;

create or replace function public.coach_completed_sets(p_from date, p_to date)
returns table (
  client_id uuid, session_id uuid, performed_on date, session_name text,
  exercise_id uuid, exercise_name text, movement_id uuid, movement_name text, is_bodyweight boolean,
  set_number int, weight_kg numeric, reps int,
  primary_muscles text[], secondary_muscles text[]
)
language sql stable security invoker set search_path = '' as $$
  select s.client_id, s.id, s.scheduled_date, s.name,
         se.exercise_id, se.exercise_name, e.movement_id, m.name, se.is_bodyweight,
         ss.set_number, ss.weight_kg, ss.reps,
         coalesce(e.primary_muscles, '{}'), coalesce(e.secondary_muscles, '{}')
  from public.coach_clients cc
  join public.workout_sessions s on s.client_id = cc.client_id
  join public.session_exercises se on se.session_id = s.id
  join public.session_sets ss on ss.session_exercise_id = se.id
  left join public.exercises e on e.id = se.exercise_id
  left join public.movements m on m.id = e.movement_id
  where cc.coach_id = auth.uid() and cc.status = 'active'
    and s.scheduled_date between p_from and p_to
    and ss.completed
    and ss.set_type <> 'warmup'
  order by s.client_id, s.scheduled_date, s.started_at, s.id, se.position, se.id, ss.set_number, ss.id;
$$;

-- 2) Coach switch.
--    A client has at most one active training plan and one nutrition plan (unique indexes),
--    but copy_plan / assign_nutrition_plan run as the new coach, and RLS hides the previous
--    coach's rows from them. The old plan was never cleared, so assigning failed with a
--    duplicate-key error and the client kept seeing the previous coach's plan.
--    When a relationship becomes active, clear what other coaches left behind for that client.
--    Training plans are only deactivated (past sessions still point at them); the old
--    nutrition plan is removed, since the unique index allows only one per client.

create function public.clear_previous_coach_plans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    update public.plans set is_active = false
      where client_id = new.client_id and coach_id <> new.coach_id and is_active;
    delete from public.nutrition_plans
      where client_id = new.client_id and coach_id <> new.coach_id;
  end if;
  return new;
end $$;
revoke execute on function public.clear_previous_coach_plans() from public, anon, authenticated;

create trigger coach_clients_clear_previous_plans
  after insert or update of status on public.coach_clients
  for each row execute function public.clear_previous_coach_plans();

-- One-off cleanup for clients who already switched coaches.
update public.plans p set is_active = false
  from public.coach_clients cc
  where cc.client_id = p.client_id and cc.status = 'active'
    and p.coach_id <> cc.coach_id and p.is_active;

delete from public.nutrition_plans np
  using public.coach_clients cc
  where cc.client_id = np.client_id and cc.status = 'active'
    and np.coach_id <> cc.coach_id;
