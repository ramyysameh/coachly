-- Phase 3 of the feature spec (heat map + coach tools):
--   1. Per-client, per-muscle weekly set targets (the coach sets them; default 10–20 when unset).
--   2. Progress photos: front / side / back, dated, in a private storage bucket.
--   3. coach_completed_sets(): completed sets for all of the calling coach's active
--      clients in one call, so the dashboard flag list doesn't query client by client.

-- ───────────────────────── Muscle set targets ─────────────────────────
-- One row per client and muscle the coach has customised. Muscles without a row use
-- the app default (10–20 hard sets per week).
create table public.muscle_targets (
  client_id uuid not null references public.profiles (id) on delete cascade,
  muscle text not null check (muscle = any (public.muscle_regions())),
  min_sets numeric(4,1) not null check (min_sets between 0 and 60),
  max_sets numeric(4,1) not null check (max_sets between 0 and 60),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (client_id, muscle),
  check (max_sets >= min_sets)
);

alter table public.muscle_targets enable row level security;
-- The client and their coach (current or past, for history) can read.
create policy "read muscle targets" on public.muscle_targets for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
-- Only the client's active coach writes, and only as themselves.
create policy "coach sets muscle targets" on public.muscle_targets for all to authenticated
  using (public.is_coach_of(client_id, true))
  with check (public.is_coach_of(client_id, true) and updated_by = auth.uid());

-- ───────────────────────── Progress photos ─────────────────────────
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  taken_on date not null check (taken_on between '2000-01-01' and current_date + 1),
  pose text not null check (pose in ('front','side','back')),
  -- object path inside the progress-photos bucket; always under the client's own folder
  storage_path text not null check (storage_path like client_id::text || '/%'),
  created_at timestamptz not null default now(),
  unique (client_id, taken_on, pose)
);
create index progress_photos_client on public.progress_photos (client_id, taken_on desc);

alter table public.progress_photos enable row level security;
create policy "read progress photos" on public.progress_photos for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "client manages own progress photos" on public.progress_photos for all to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

-- Private bucket: no public URLs. Files live under "<client id>/…".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Is the calling user (current or past) coach of the client whose folder this is?
-- Compares as text so a malformed folder name can't raise a cast error inside a policy.
create function public.is_coach_of_folder(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_clients cc
    where cc.coach_id = auth.uid() and cc.client_id::text = p_folder
  );
$$;
revoke execute on function public.is_coach_of_folder(text) from public, anon;
grant execute on function public.is_coach_of_folder(text) to authenticated;

create policy "progress photos: client uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "progress photos: client updates own" on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "progress photos: client deletes own" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- The client and their coach can read (signed URLs need this); nobody else.
create policy "progress photos: client and coach read" on storage.objects for select to authenticated
  using (
    bucket_id = 'progress-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_coach_of_folder((storage.foldername(name))[1]))
  );

-- ───────────────────────── Completed sets for the coach's clients ─────────────────────────
-- Same columns as completed_sets() plus client_id, for every active client of the caller.
-- security invoker: row level security still applies on top of the coach filter.
create function public.coach_completed_sets(p_from date, p_to date)
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
  order by s.client_id, s.scheduled_date, s.started_at, se.position, ss.set_number;
$$;

revoke execute on function public.coach_completed_sets(date, date) from public, anon;
grant execute on function public.coach_completed_sets(date, date) to authenticated;
