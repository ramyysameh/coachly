-- Phase 2 (analytics): one flat row per completed set, with the exercise's movement
-- and muscle tags. Every stat (estimated 1RM, PRs, weekly sets per muscle, frequency)
-- is calculated from this in the app, so nothing is stored twice.
-- security invoker: row level security decides whose sets the caller can see.
create function public.completed_sets(p_client uuid, p_from date, p_to date)
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
  order by s.scheduled_date, s.started_at, se.position, ss.set_number;
$$;

revoke execute on function public.completed_sets(uuid, date, date) from public, anon;
grant execute on function public.completed_sets(uuid, date, date) to authenticated;
