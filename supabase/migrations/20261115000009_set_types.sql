-- Set types: a logged set can be marked warm-up, drop or to-failure.
-- Warm-ups are preparation, not training stimulus: they are left out of every analytics
-- feed (PRs, est. 1RM, weekly sets per muscle, volume). Drop and failure sets still count.

alter table public.session_sets
  add column set_type text not null default 'normal'
  check (set_type in ('normal', 'warmup', 'drop', 'failure'));

-- Same signature and columns as in 20261113000007, plus the warm-up filter.
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
  order by s.scheduled_date, s.started_at, se.position, ss.set_number;
$$;

-- Same signature and columns as in 20261113000008, plus the warm-up filter.
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
  order by s.client_id, s.scheduled_date, s.started_at, se.position, ss.set_number;
$$;
