-- Missed sessions for all of the calling coach's active clients in one query
-- (the dashboard previously made one missed_sessions() call per client).
create function public.coach_missed_sessions(p_from date, p_to date)
returns table (client_id uuid, scheduled_date date, plan_day_id uuid, day_name text)
language sql stable security invoker set search_path = '' as $$
  select p.client_id, g::date, d.id, d.name
  from public.coach_clients cc
  join public.plans p on p.client_id = cc.client_id and p.is_active
  join public.plan_days d on d.plan_id = p.id
  cross join lateral generate_series(greatest(p_from, p.start_date), p_to, interval '1 day') g
  where cc.coach_id = auth.uid() and cc.status = 'active'
    and extract(isodow from g)::smallint = any (d.weekdays)
    and not exists (
      select 1 from public.workout_sessions s
      where s.client_id = p.client_id and s.plan_day_id = d.id
        and s.scheduled_date = g::date and s.status = 'completed'
    )
  order by 2 desc;
$$;

revoke execute on function public.coach_missed_sessions(date, date) from public, anon;
grant execute on function public.coach_missed_sessions(date, date) to authenticated;
