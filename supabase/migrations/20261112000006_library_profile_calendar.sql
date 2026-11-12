-- Phase 1 of the feature spec:
--   1. Exercise library as movement → variant, with primary/secondary muscle tags
--      (these drive per-muscle volume and the heat map later), cues and an image slot.
--   2. Client profile header fields (photo, date of birth, height, goal type, level,
--      injuries, training days per week) + an avatars storage bucket.
-- The existing `exercises` table stays the variant table so every plan and logged
-- set keeps pointing at the same rows.

-- ───────────────────────── Muscle regions ─────────────────────────
create function public.muscle_regions() returns text[]
language sql immutable set search_path = '' as $$
  select array['chest','front_delts','side_delts','rear_delts','biceps','triceps','forearms',
               'abs','obliques','traps','lats','lower_back','glutes','quads','hamstrings',
               'adductors','calves']::text[];
$$;

-- ───────────────────────── Movements ─────────────────────────
create table public.movements (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  pattern text not null check (pattern in ('push','pull','squat','hinge','lunge','carry','core','isolation')),
  created_by uuid references public.profiles (id) on delete cascade, -- null = built-in
  created_at timestamptz not null default now()
);
create unique index movements_builtin_name on public.movements (lower(name)) where created_by is null;
create index movements_created_by on public.movements (created_by);

alter table public.movements enable row level security;
create policy "read movements" on public.movements for select to authenticated
  using (created_by is null or created_by = auth.uid() or public.is_client_of(created_by));
create policy "coach adds movements" on public.movements for insert to authenticated
  with check (created_by = auth.uid() and public.my_role() = 'coach');
create policy "coach edits movements" on public.movements for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "coach deletes movements" on public.movements for delete to authenticated
  using (created_by = auth.uid());

-- ───────────────────────── Variant fields on exercises ─────────────────────────
alter table public.exercises
  add column movement_id uuid references public.movements (id) on delete set null,
  add column angle text check (angle in ('flat','incline','decline')),
  add column grip text check (grip in ('overhand','underhand','neutral','wide','close')),
  add column unilateral boolean not null default false,
  add column primary_muscles text[] not null default '{}' check (primary_muscles <@ public.muscle_regions()),
  add column secondary_muscles text[] not null default '{}' check (secondary_muscles <@ public.muscle_regions()),
  add column cues text[] not null default '{}',
  add column mistakes text[] not null default '{}',
  add column image_url text;
create index exercises_movement on public.exercises (movement_id);

insert into public.movements (name, pattern) values
  ('Chest press', 'push'), ('Chest fly', 'push'), ('Push-up', 'push'), ('Dip', 'push'),
  ('Shoulder press', 'push'), ('Lateral raise', 'isolation'), ('Rear delt', 'pull'),
  ('Triceps extension', 'isolation'), ('Deadlift', 'hinge'), ('Row', 'pull'),
  ('Pull-up', 'pull'), ('Lat pulldown', 'pull'), ('Curl', 'isolation'), ('Squat', 'squat'),
  ('Leg press', 'squat'), ('Lunge', 'lunge'), ('Leg extension', 'isolation'), ('Leg curl', 'isolation'),
  ('Hip thrust', 'hinge'), ('Calf raise', 'isolation'), ('Plank', 'core'), ('Leg raise', 'core'),
  ('Crunch', 'core'), ('Rollout', 'core'), ('Carry', 'carry');

-- Tag the existing built-in exercises.
update public.exercises e set
  movement_id = m.id, angle = v.angle, grip = v.grip, unilateral = v.uni,
  primary_muscles = v.pm, secondary_muscles = v.sm, cues = v.cues, mistakes = v.mis
from (values
  ('Barbell Bench Press', 'Chest press', 'flat'::text, null::text, false, '{chest}'::text[], '{front_delts,triceps}'::text[],
    '{"Shoulder blades pinned back and down","Bar touches mid-chest","Drive feet into the floor"}'::text[], '{"Bouncing the bar off the chest","Elbows flared to 90°"}'::text[]),
  ('Incline Dumbbell Press', 'Chest press', 'incline', null, false, '{chest,front_delts}', '{triceps}',
    '{"Bench at 30–45°","Lower to upper chest","Press up and slightly in"}', '{"Bench set too steep"}'),
  ('Close-Grip Bench Press', 'Chest press', 'flat', 'close', false, '{triceps,chest}', '{front_delts}',
    '{"Hands shoulder-width","Elbows tucked close to the body"}', '{"Grip so narrow the wrists bend"}'),
  ('Dumbbell Fly', 'Chest fly', 'flat', null, false, '{chest}', '{front_delts}',
    '{"Soft bend in the elbows","Stretch wide, squeeze together"}', '{"Turning it into a press"}'),
  ('Cable Crossover', 'Chest fly', null, null, false, '{chest}', '{front_delts}',
    '{"Lean slightly forward","Hands meet in front of the chest"}', '{}'),
  ('Push-Up', 'Push-up', null, null, false, '{chest}', '{triceps,front_delts,abs}',
    '{"Body in one straight line","Chest to the floor"}', '{"Hips sagging"}'),
  ('Dip', 'Dip', null, null, false, '{chest,triceps}', '{front_delts}',
    '{"Lean forward for more chest","Lower until shoulders are below elbows"}', '{"Shrugging the shoulders up"}'),
  ('Overhead Press', 'Shoulder press', null, null, false, '{front_delts}', '{side_delts,triceps,traps}',
    '{"Squeeze glutes and brace","Head through once the bar passes the face"}', '{"Leaning back excessively"}'),
  ('Seated Dumbbell Shoulder Press', 'Shoulder press', null, null, false, '{front_delts}', '{side_delts,triceps}',
    '{"Back against the pad","Lower to ear height"}', '{}'),
  ('Lateral Raise', 'Lateral raise', null, null, false, '{side_delts}', '{traps}',
    '{"Lead with the elbows","Stop at shoulder height"}', '{"Swinging the weight up"}'),
  ('Face Pull', 'Rear delt', null, null, false, '{rear_delts}', '{traps}',
    '{"Pull rope towards the forehead","Spread the rope apart at the end"}', '{}'),
  ('Rear Delt Fly', 'Rear delt', null, null, false, '{rear_delts}', '{traps}',
    '{"Hinge forward, flat back","Lead with the pinkies"}', '{}'),
  ('Triceps Pushdown', 'Triceps extension', null, null, false, '{triceps}', '{}',
    '{"Elbows pinned to your sides","Full lockout at the bottom"}', '{"Elbows drifting forward"}'),
  ('Overhead Triceps Extension', 'Triceps extension', null, null, false, '{triceps}', '{}',
    '{"Elbows pointing up","Deep stretch behind the head"}', '{}'),
  ('Skull Crusher', 'Triceps extension', null, null, false, '{triceps}', '{}',
    '{"Lower to the forehead","Upper arms stay still"}', '{}'),
  ('Deadlift', 'Deadlift', null, null, false, '{hamstrings,glutes,lower_back}', '{traps,quads,forearms,lats}',
    '{"Bar over mid-foot","Brace, then push the floor away","Bar stays close to the legs"}', '{"Rounding the lower back","Hips shooting up first"}'),
  ('Romanian Deadlift', 'Deadlift', null, null, false, '{hamstrings,glutes}', '{lower_back,forearms}',
    '{"Soft knees, push the hips back","Stop when the hamstrings are fully stretched"}', '{"Squatting the weight down"}'),
  ('Barbell Row', 'Row', null, 'overhand', false, '{lats,traps}', '{rear_delts,biceps,lower_back}',
    '{"Torso near 45°","Pull to the lower ribs"}', '{"Standing up to cheat the weight"}'),
  ('Seated Cable Row', 'Row', null, 'neutral', false, '{lats,traps}', '{rear_delts,biceps}',
    '{"Chest tall","Squeeze shoulder blades together"}', '{}'),
  ('One-Arm Dumbbell Row', 'Row', null, 'neutral', true, '{lats}', '{traps,rear_delts,biceps}',
    '{"Pull the elbow towards the hip","Keep hips square"}', '{}'),
  ('T-Bar Row', 'Row', null, 'neutral', false, '{lats,traps}', '{rear_delts,biceps}',
    '{"Flat back","Pull to the chest"}', '{}'),
  ('Pull-Up', 'Pull-up', null, 'overhand', false, '{lats}', '{biceps,traps,forearms}',
    '{"Start from a dead hang","Chest to the bar"}', '{"Half reps"}'),
  ('Chin-Up', 'Pull-up', null, 'underhand', false, '{lats,biceps}', '{traps,forearms}',
    '{"Shoulder-width underhand grip","Chin clears the bar"}', '{}'),
  ('Lat Pulldown', 'Lat pulldown', null, 'wide', false, '{lats}', '{biceps,traps,rear_delts}',
    '{"Pull the bar to the upper chest","Lean back slightly"}', '{"Pulling behind the neck"}'),
  ('Barbell Curl', 'Curl', null, 'underhand', false, '{biceps}', '{forearms}',
    '{"Elbows stay by your sides","Control the way down"}', '{"Swinging the hips"}'),
  ('Dumbbell Curl', 'Curl', null, 'underhand', false, '{biceps}', '{forearms}',
    '{"Rotate palms up as you curl"}', '{}'),
  ('Hammer Curl', 'Curl', null, 'neutral', false, '{biceps,forearms}', '{}',
    '{"Thumbs up the whole time"}', '{}'),
  ('Preacher Curl', 'Curl', null, 'underhand', false, '{biceps}', '{forearms}',
    '{"Armpits on the pad","Full stretch at the bottom"}', '{}'),
  ('Back Squat', 'Squat', null, null, false, '{quads,glutes}', '{adductors,lower_back,hamstrings}',
    '{"Brace before you descend","Knees track over the toes","Hips at or below the knees"}', '{"Knees caving in","Heels lifting"}'),
  ('Front Squat', 'Squat', null, null, false, '{quads}', '{glutes,abs,traps}',
    '{"Elbows high","Stay upright"}', '{"Elbows dropping"}'),
  ('Bodyweight Squat', 'Squat', null, null, false, '{quads,glutes}', '{}',
    '{"Sit between the heels","Chest up"}', '{}'),
  ('Leg Press', 'Leg press', null, null, false, '{quads,glutes}', '{adductors}',
    '{"Lower back stays on the pad","Don''t lock the knees"}', '{"Hips rolling off the seat"}'),
  ('Walking Lunge', 'Lunge', null, null, true, '{quads,glutes}', '{adductors,hamstrings}',
    '{"Long stride","Back knee kisses the floor"}', '{}'),
  ('Bulgarian Split Squat', 'Lunge', null, null, true, '{quads,glutes}', '{adductors}',
    '{"Rear foot on the bench","Front shin roughly vertical"}', '{}'),
  ('Leg Extension', 'Leg extension', null, null, false, '{quads}', '{}',
    '{"Pause at the top"}', '{}'),
  ('Lying Leg Curl', 'Leg curl', null, null, false, '{hamstrings}', '{calves}',
    '{"Hips pressed into the pad","Slow on the way down"}', '{}'),
  ('Hip Thrust', 'Hip thrust', null, null, false, '{glutes}', '{hamstrings}',
    '{"Chin tucked","Full hip lockout, squeeze the glutes"}', '{"Arching the lower back at the top"}'),
  ('Standing Calf Raise', 'Calf raise', null, null, false, '{calves}', '{}',
    '{"Full stretch at the bottom","Pause at the top"}', '{"Bouncing"}'),
  ('Plank', 'Plank', null, null, false, '{abs}', '{obliques}',
    '{"Squeeze glutes","Ribs down"}', '{"Hips sagging"}'),
  ('Hanging Leg Raise', 'Leg raise', null, null, false, '{abs}', '{obliques,forearms}',
    '{"Curl the pelvis up","No swinging"}', '{}'),
  ('Cable Crunch', 'Crunch', null, null, false, '{abs}', '{obliques}',
    '{"Crunch ribs towards the hips","Hips stay still"}', '{}'),
  ('Ab Wheel Rollout', 'Rollout', null, null, false, '{abs}', '{lats,obliques}',
    '{"Hollow body","Roll only as far as you can control"}', '{"Lower back arching"}')
) as v(name, movement, angle, grip, uni, pm, sm, cues, mis)
join public.movements m on m.name = v.movement and m.created_by is null
where e.name = v.name and e.created_by is null;

-- New built-in variants (from the spec's movement → variant table).
insert into public.exercises (name, muscle_group, equipment, is_bodyweight, movement_id, angle, grip, unilateral,
                              primary_muscles, secondary_muscles, cues)
select v.name, v.grp, v.equip, false, m.id, v.angle, v.grip, v.uni, v.pm, v.sm, v.cues
from (values
  ('Flat Dumbbell Press', 'Chest', 'Dumbbell', 'Chest press', 'flat'::text, null::text, false, '{chest}'::text[], '{front_delts,triceps}'::text[], '{"Dumbbells over the chest","Lower until elbows pass the bench"}'::text[]),
  ('Machine Chest Press', 'Chest', 'Machine', 'Chest press', 'flat', null, false, '{chest}', '{front_delts,triceps}', '{"Handles at mid-chest height"}'),
  ('Incline Barbell Press', 'Chest', 'Barbell', 'Chest press', 'incline', null, false, '{chest,front_delts}', '{triceps}', '{"Bar to the upper chest"}'),
  ('Decline Barbell Press', 'Chest', 'Barbell', 'Chest press', 'decline', null, false, '{chest}', '{triceps,front_delts}', '{"Lock the legs in","Bar to the lower chest"}'),
  ('Smith Machine Bench Press', 'Chest', 'Smith', 'Chest press', 'flat', null, false, '{chest}', '{front_delts,triceps}', '{"Set the safeties first"}'),
  ('Goblet Squat', 'Legs', 'Dumbbell', 'Squat', null, null, false, '{quads,glutes}', '{abs,adductors}', '{"Hold the dumbbell at the chest","Elbows inside the knees"}'),
  ('Hack Squat', 'Legs', 'Machine', 'Squat', null, null, false, '{quads}', '{glutes,adductors}', '{"Back flat on the pad","Go deep"}'),
  ('Smith Machine Squat', 'Legs', 'Smith', 'Squat', null, null, false, '{quads,glutes}', '{adductors}', '{"Feet slightly in front of the bar"}'),
  ('Chest-Supported Machine Row', 'Back', 'Machine', 'Row', null, 'neutral', false, '{lats,traps}', '{rear_delts,biceps}', '{"Chest stays on the pad"}'),
  ('Close-Grip Lat Pulldown', 'Back', 'Cable', 'Lat pulldown', null, 'close', false, '{lats}', '{biceps,traps}', '{"Neutral handle","Elbows down to the ribs"}'),
  ('Underhand Lat Pulldown', 'Back', 'Cable', 'Lat pulldown', null, 'underhand', false, '{lats,biceps}', '{traps}', '{"Shoulder-width grip"}'),
  ('Single-Arm Cable Pulldown', 'Back', 'Cable', 'Lat pulldown', null, null, true, '{lats}', '{biceps}', '{"Pull the elbow to the hip"}'),
  ('Machine Shoulder Press', 'Shoulders', 'Machine', 'Shoulder press', null, null, false, '{front_delts}', '{side_delts,triceps}', '{"Handles start at ear height"}'),
  ('Arnold Press', 'Shoulders', 'Dumbbell', 'Shoulder press', null, null, false, '{front_delts,side_delts}', '{triceps}', '{"Rotate palms out as you press"}'),
  ('Farmer''s Carry', 'Core', 'Dumbbell', 'Carry', null, 'neutral', false, '{forearms,traps}', '{abs,obliques}', '{"Tall posture","Short, quick steps"}'),
  ('Kettlebell Swing', 'Glutes', 'Kettlebell', 'Hip thrust', null, null, false, '{glutes,hamstrings}', '{lower_back,abs}', '{"Hinge, don''t squat","Snap the hips"}'),
  ('Band Pull-Apart', 'Shoulders', 'Band', 'Rear delt', null, 'overhand', false, '{rear_delts}', '{traps}', '{"Arms straight","Squeeze shoulder blades"}')
) as v(name, grp, equip, movement, angle, grip, uni, pm, sm, cues)
join public.movements m on m.name = v.movement and m.created_by is null;

-- ───────────────────────── Profile header fields ─────────────────────────
alter table public.profiles
  add column avatar_url text,
  add column date_of_birth date check (date_of_birth is null or date_of_birth between '1900-01-01' and current_date),
  add column height_cm numeric(5,1) check (height_cm is null or height_cm between 50 and 260),
  add column height_unit text not null default 'cm' check (height_unit in ('cm','ft')),
  add column goal_type text check (goal_type in ('fat_loss','muscle_gain','strength','general')),
  add column experience_level text check (experience_level in ('beginner','intermediate','advanced')),
  add column injuries text check (injuries is null or length(injuries) <= 1000),
  add column training_days_per_week smallint check (training_days_per_week is null or training_days_per_week between 1 and 7);

-- Coaches can set the coaching fields on their own clients (clients edit everything else themselves).
create function public.coach_update_client(
  p_client uuid, p_goal_type text, p_experience_level text, p_injuries text, p_training_days smallint
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach_of(p_client) then
    raise exception 'Not your client';
  end if;
  update public.profiles set
    goal_type = p_goal_type,
    experience_level = p_experience_level,
    injuries = nullif(trim(p_injuries), ''),
    training_days_per_week = p_training_days
  where id = p_client;
end $$;
revoke execute on function public.coach_update_client(uuid, text, text, text, smallint) from public, anon;
grant execute on function public.coach_update_client(uuid, text, text, text, smallint) to authenticated;

-- ───────────────────────── Avatars bucket ─────────────────────────
-- Public read (URLs are unguessable per user folder); users write only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────── Custom exercise photos ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "exercise media: coach uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text and public.my_role() = 'coach');
create policy "exercise media: coach updates own" on storage.objects for update to authenticated
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "exercise media: coach deletes own" on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Owners can list their own files (storage needs this for replace and delete; public URLs don't).
create policy "avatars: read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "exercise media: read own" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);
