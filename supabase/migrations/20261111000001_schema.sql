-- Coaching app schema: roles, coach–client relationships, plans, workout logs,
-- nutrition, body weight, private notes and messaging.
-- All access is enforced with row level security (RLS).

create extension if not exists pgcrypto;

-- ───────────────────────── Profiles ─────────────────────────
create type public.user_role as enum ('coach', 'client');
create type public.weight_unit as enum ('kg', 'lb');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  full_name text not null default '',
  goal text,
  weight_unit public.weight_unit not null default 'kg',
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- Create a profile for every new auth user. Role comes from sign-up metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, full_name, onboarded)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'client')::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    -- coaches skip client onboarding
    coalesce(new.raw_user_meta_data ->> 'role', 'client') = 'coach'
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users can never change their own role.
create function public.prevent_role_change() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Role cannot be changed';
  end if;
  return new;
end $$;

create trigger profiles_role_locked before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ───────────────────── Coach–client relationships ─────────────────────
create type public.relationship_status as enum ('active', 'archived');

create table public.coach_clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status public.relationship_status not null default 'active',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
-- One active coach per client.
create unique index coach_clients_one_active on public.coach_clients (client_id) where status = 'active';
create index coach_clients_coach on public.coach_clients (coach_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  note text,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Access helpers. SECURITY DEFINER so they can be used inside policies without recursion.
create function public.is_coach_of(p_client uuid, p_active_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_clients cc
    where cc.coach_id = auth.uid() and cc.client_id = p_client
      and (not p_active_only or cc.status = 'active')
  );
$$;

create function public.is_client_of(p_coach uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_clients cc
    where cc.client_id = auth.uid() and cc.coach_id = p_coach
  );
$$;

create function public.my_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ───────────────────────── Exercise library ─────────────────────────
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  muscle_group text,
  equipment text,
  is_bodyweight boolean not null default false,
  created_by uuid references public.profiles (id) on delete cascade, -- null = built-in
  created_at timestamptz not null default now()
);
create index exercises_created_by on public.exercises (created_by);

-- ───────────────────────── Plans ─────────────────────────
-- client_id null  → reusable template owned by the coach
-- client_id set   → plan assigned to that client from start_date
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  start_date date,
  is_active boolean not null default false,
  source_plan_id uuid references public.plans (id) on delete set null,
  created_at timestamptz not null default now(),
  check (client_id is null or start_date is not null)
);
create unique index plans_one_active_per_client on public.plans (client_id) where is_active;
create index plans_coach on public.plans (coach_id);

create table public.plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  position int not null default 0,
  name text not null check (length(trim(name)) > 0),
  -- ISO weekdays this workout is scheduled on (1 = Monday … 7 = Sunday)
  weekdays smallint[] not null default '{}' check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
);
create index plan_days_plan on public.plan_days (plan_id);

create table public.plan_exercises (
  id uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.plan_days (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position int not null default 0,
  target_sets int not null default 3 check (target_sets between 1 and 20),
  rep_min int not null default 8 check (rep_min between 1 and 100),
  rep_max int not null default 12 check (rep_max between 1 and 100),
  rest_seconds int not null default 90 check (rest_seconds between 0 and 1800),
  notes text,
  check (rep_max >= rep_min)
);
create index plan_exercises_day on public.plan_exercises (plan_day_id);

-- ───────────────────────── Workout logs ─────────────────────────
-- Sessions copy (snapshot) their targets when started, so later plan edits
-- never change completed sessions.
create type public.session_status as enum ('in_progress', 'completed');

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  plan_day_id uuid references public.plan_days (id) on delete set null,
  scheduled_date date not null,
  name text not null,
  status public.session_status not null default 'in_progress',
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index workout_sessions_one_per_day on public.workout_sessions (client_id, plan_day_id, scheduled_date)
  where plan_day_id is not null;
create index workout_sessions_client on public.workout_sessions (client_id, scheduled_date desc);

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  position int not null default 0,
  exercise_name text not null,
  is_bodyweight boolean not null default false,
  target_sets int not null,
  rep_min int not null,
  rep_max int not null,
  rest_seconds int not null,
  coach_notes text,
  client_notes text
);
create index session_exercises_session on public.session_exercises (session_id);
create index session_exercises_exercise on public.session_exercises (exercise_id);

create table public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises (id) on delete cascade,
  set_number int not null check (set_number >= 1),
  reps int check (reps is null or reps between 0 and 1000),
  weight_kg numeric(7,3) check (weight_kg is null or weight_kg between 0 and 2000),
  completed boolean not null default false,
  unique (session_exercise_id, set_number)
);

-- ───────────────────────── Nutrition ─────────────────────────
create table public.nutrition_targets (
  client_id uuid primary key references public.profiles (id) on delete cascade,
  calories int not null check (calories between 0 and 20000),
  protein_g int not null check (protein_g between 0 and 2000),
  carbs_g int not null check (carbs_g between 0 and 2000),
  fat_g int not null check (fat_g between 0 and 2000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');

create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  meal public.meal_type not null,
  food_name text not null check (length(trim(food_name)) > 0),
  serving text not null default '1 serving',
  calories numeric(7,1) not null default 0 check (calories >= 0),
  protein_g numeric(6,1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6,1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6,1) not null default 0 check (fat_g >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_entries_client_date on public.meal_entries (client_id, entry_date);

create table public.body_weights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg between 20 and 500),
  unique (client_id, entry_date)
);

-- Private coach notes — visible only to the coach who wrote them.
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index coach_notes_pair on public.coach_notes (coach_id, client_id);

-- ───────────────────────── Messaging ─────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null unique references public.coach_clients (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- id is generated by the sender's device so a retried send is idempotent.
create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages (conversation_id, created_at);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- One conversation per relationship, created automatically.
create function public.create_conversation_for_relationship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.conversations (relationship_id, coach_id, client_id)
  values (new.id, new.coach_id, new.client_id)
  on conflict (relationship_id) do nothing;
  return new;
end $$;

create trigger coach_clients_conversation after insert on public.coach_clients
  for each row execute function public.create_conversation_for_relationship();

create function public.is_conversation_member(p_conversation uuid, p_active_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.coach_clients cc on cc.id = c.relationship_id
    where c.id = p_conversation
      and auth.uid() in (c.coach_id, c.client_id)
      and (not p_active_only or cc.status = 'active')
  );
$$;

-- Server timestamps can't be faked by the client.
create function public.set_server_time() returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end $$;
create trigger messages_server_time before insert on public.messages
  for each row execute function public.set_server_time();

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger meal_entries_touch before update on public.meal_entries
  for each row execute function public.touch_updated_at();
create trigger workout_sessions_touch before update on public.workout_sessions
  for each row execute function public.touch_updated_at();
