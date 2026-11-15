-- Body measurements alongside the weight log, and an optional demo video link on exercises.

-- ───────────────────────── Body measurements ─────────────────────────
-- One row per client per day, in centimetres (the app shows inches to lb users). Every site is
-- optional, but a row must hold at least one.
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null check (entry_date between '2000-01-01' and current_date + 1),
  waist_cm numeric(5,1) check (waist_cm between 20 and 300),
  chest_cm numeric(5,1) check (chest_cm between 20 and 300),
  hips_cm numeric(5,1) check (hips_cm between 20 and 300),
  arm_cm numeric(5,1) check (arm_cm between 10 and 150),
  thigh_cm numeric(5,1) check (thigh_cm between 10 and 200),
  created_at timestamptz not null default now(),
  unique (client_id, entry_date),
  check (num_nonnulls(waist_cm, chest_cm, hips_cm, arm_cm, thigh_cm) > 0)
);

alter table public.body_measurements enable row level security;
revoke all on public.body_measurements from anon;
-- Same access as body_weights: the client and their coach (current or past) read; only the client writes.
create policy "read body measurements" on public.body_measurements for select to authenticated
  using (client_id = auth.uid() or public.is_coach_of(client_id));
create policy "client writes body measurements" on public.body_measurements for all to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- ───────────────────────── Exercise demo video ─────────────────────────
-- A link (YouTube, Vimeo, a coach's own upload) opened in a new tab. https only.
alter table public.exercises
  add column video_url text check (video_url is null or (video_url ~ '^https://[^\s]+$' and length(video_url) <= 500));
