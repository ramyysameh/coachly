-- DEMO DATA — every record here is sample data, labelled "(Sample)".
-- Accounts (password for all: demo-pass-123):
--   coach@demo.test   Demo Coach (Sample)
--   alex@demo.test    Alex Rivera (Sample)   — Push/Pull/Legs, kg
--   sam@demo.test     Sam Chen (Sample)      — Upper/Lower, lb
--   coach2@demo.test  Other Coach (Sample)   — no clients; used to test access denial

create or replace function pg_temp.demo_user(p_id uuid, p_email text, p_name text, p_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    crypt('demo-pass-123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_name, 'role', p_role), now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
end $$;

select pg_temp.demo_user('11111111-1111-1111-1111-111111111111', 'coach@demo.test', 'Demo Coach (Sample)', 'coach');
select pg_temp.demo_user('22222222-2222-2222-2222-222222222222', 'alex@demo.test', 'Alex Rivera (Sample)', 'client');
select pg_temp.demo_user('33333333-3333-3333-3333-333333333333', 'sam@demo.test', 'Sam Chen (Sample)', 'client');
select pg_temp.demo_user('44444444-4444-4444-4444-444444444444', 'coach2@demo.test', 'Other Coach (Sample)', 'coach');

update public.profiles set onboarded = true, goal = 'Build muscle — add 5 kg lean mass (Sample)', weight_unit = 'kg'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set onboarded = true, goal = 'Lose fat and get stronger (Sample)', weight_unit = 'lb'
  where id = '33333333-3333-3333-3333-333333333333';

insert into public.coach_clients (coach_id, client_id, created_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', now() - interval '30 days'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', now() - interval '20 days');

do $$
declare
  v_coach uuid := '11111111-1111-1111-1111-111111111111';
  v_alex uuid := '22222222-2222-2222-2222-222222222222';
  v_sam uuid := '33333333-3333-3333-3333-333333333333';
  v_ppl uuid; v_ul uuid; v_day uuid;
  v_plan uuid; v_session uuid; v_se uuid;
  r record; pe record; d date; i int; n int;
  ex_id uuid;
begin
  -- helper: exercise id by name
  create temp table ex on commit drop as select id, name, is_bodyweight from public.exercises where created_by is null;

  -- ── Templates ──
  insert into public.plans (coach_id, name, description)
    values (v_coach, 'Push / Pull / Legs (Sample)', 'Six-day hypertrophy split. Sample template.') returning id into v_ppl;
  insert into public.plans (coach_id, name, description)
    values (v_coach, 'Upper / Lower (Sample)', 'Four-day strength split. Sample template.') returning id into v_ul;

  -- PPL days
  for r in select * from (values
      (0, 'Push', array[1,4]::smallint[]), (1, 'Pull', array[2,5]::smallint[]), (2, 'Legs', array[3,6]::smallint[])) t(pos, name, wd)
  loop
    insert into public.plan_days (plan_id, position, name, weekdays) values (v_ppl, r.pos, r.name, r.wd) returning id into v_day;
    insert into public.plan_exercises (plan_day_id, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes)
    select v_day, ex.id, x.pos, x.sets, x.rmin, x.rmax, x.rest, x.note
    from (values
      ('Push', 0, 'Barbell Bench Press', 4, 6, 8, 150, 'Pause 1s on chest'),
      ('Push', 1, 'Overhead Press', 3, 6, 10, 120, null),
      ('Push', 2, 'Incline Dumbbell Press', 3, 8, 12, 90, null),
      ('Push', 3, 'Lateral Raise', 3, 12, 15, 60, 'Slow eccentric'),
      ('Push', 4, 'Triceps Pushdown', 3, 10, 15, 60, null),
      ('Pull', 0, 'Deadlift', 3, 4, 6, 180, 'Reset each rep'),
      ('Pull', 1, 'Pull-Up', 3, 6, 10, 120, 'Add weight once you hit 10'),
      ('Pull', 2, 'Seated Cable Row', 3, 8, 12, 90, null),
      ('Pull', 3, 'Face Pull', 3, 12, 15, 60, null),
      ('Pull', 4, 'Dumbbell Curl', 3, 10, 12, 60, null),
      ('Legs', 0, 'Back Squat', 4, 5, 8, 180, 'Belt on top sets'),
      ('Legs', 1, 'Romanian Deadlift', 3, 8, 10, 120, null),
      ('Legs', 2, 'Leg Press', 3, 10, 12, 90, null),
      ('Legs', 3, 'Lying Leg Curl', 3, 10, 15, 60, null),
      ('Legs', 4, 'Standing Calf Raise', 4, 12, 15, 60, null)
    ) x(day, pos, ex_name, sets, rmin, rmax, rest, note)
    join ex on ex.name = x.ex_name
    where x.day = r.name;
  end loop;

  -- Upper/Lower days
  for r in select * from (values
      (0, 'Upper', array[1,4]::smallint[]), (1, 'Lower', array[2,5]::smallint[])) t(pos, name, wd)
  loop
    insert into public.plan_days (plan_id, position, name, weekdays) values (v_ul, r.pos, r.name, r.wd) returning id into v_day;
    insert into public.plan_exercises (plan_day_id, exercise_id, position, target_sets, rep_min, rep_max, rest_seconds, notes)
    select v_day, ex.id, x.pos, x.sets, x.rmin, x.rmax, x.rest, x.note
    from (values
      ('Upper', 0, 'Barbell Bench Press', 3, 5, 8, 150, null),
      ('Upper', 1, 'Barbell Row', 3, 6, 10, 120, null),
      ('Upper', 2, 'Seated Dumbbell Shoulder Press', 3, 8, 12, 90, null),
      ('Upper', 3, 'Chin-Up', 3, 5, 10, 90, 'Use band if needed'),
      ('Upper', 4, 'Push-Up', 2, 10, 20, 60, 'Finisher'),
      ('Lower', 0, 'Back Squat', 3, 5, 8, 180, null),
      ('Lower', 1, 'Romanian Deadlift', 3, 8, 10, 120, null),
      ('Lower', 2, 'Walking Lunge', 3, 10, 12, 90, 'Reps per leg'),
      ('Lower', 3, 'Plank', 3, 30, 60, 60, 'Reps = seconds held')
    ) x(day, pos, ex_name, sets, rmin, rmax, rest, note)
    join ex on ex.name = x.ex_name
    where x.day = r.name;
  end loop;
end $$;

-- Assign plans by copying templates (same path the app uses).
-- copy_plan relies on auth.uid(), so impersonate the demo coach.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.copy_plan((select id from public.plans where name = 'Push / Pull / Legs (Sample)' and client_id is null),
  'Alex — PPL Block 1 (Sample)', '22222222-2222-2222-2222-222222222222', current_date - 21);
select public.copy_plan((select id from public.plans where name = 'Upper / Lower (Sample)' and client_id is null),
  'Sam — Upper/Lower (Sample)', '33333333-3333-3333-3333-333333333333', current_date - 14);

-- Workout history: completed sessions on scheduled days, skipping a few so "missed" shows.
do $$
declare
  r record; pe record; v_session uuid; v_se uuid; n int; w numeric; reps int; k int := 0;
begin
  for r in
    select p.client_id, p.id as plan_id, d.id as day_id, d.name, g::date as day
    from public.plans p join public.plan_days d on d.plan_id = p.id
    cross join lateral generate_series(p.start_date, current_date - 1, interval '1 day') g
    where p.is_active and extract(isodow from g)::smallint = any(d.weekdays)
    order by g
  loop
    k := k + 1;
    -- leave roughly every 5th scheduled session unlogged so 'missed' sessions show up
    continue when k % 5 = 0;
    insert into public.workout_sessions (client_id, plan_id, plan_day_id, scheduled_date, name, status, started_at, completed_at, notes)
    values (r.client_id, r.plan_id, r.day_id, r.day, r.name, 'completed',
            r.day + time '18:00', r.day + time '19:05', case when k % 3 = 0 then 'Felt strong today (Sample)' end)
    returning id into v_session;

    for pe in
      select x.*, e.name as ename, e.is_bodyweight from public.plan_exercises x join public.exercises e on e.id = x.exercise_id
      where x.plan_day_id = r.day_id order by x.position
    loop
      insert into public.session_exercises (session_id, exercise_id, position, exercise_name, is_bodyweight,
        target_sets, rep_min, rep_max, rest_seconds, coach_notes)
      values (v_session, pe.exercise_id, pe.position, pe.ename, pe.is_bodyweight,
        pe.target_sets, pe.rep_min, pe.rep_max, pe.rest_seconds, pe.notes)
      returning id into v_se;
      -- progressive overload: weight rises ~2.5% per week
      w := case
        when pe.is_bodyweight then null
        when pe.ename in ('Deadlift') then 120
        when pe.ename in ('Back Squat') then 95
        when pe.ename in ('Barbell Bench Press') then 75
        when pe.ename in ('Romanian Deadlift', 'Leg Press') then 80
        when pe.ename in ('Overhead Press', 'Barbell Row') then 50
        else 20 end;
      if w is not null then
        w := round((w * (1 + 0.025 * ((r.day - (current_date - 21)) / 7.0))) / 2.5) * 2.5;
        if r.client_id = '33333333-3333-3333-3333-333333333333' then w := round(w * 0.8 / 2.5) * 2.5; end if;
      end if;
      for n in 1..pe.target_sets loop
        reps := least(pe.rep_max, pe.rep_min + ((r.day - (current_date - 21)) / 7) + (case when n = 1 then 1 else 0 end));
        insert into public.session_sets (session_exercise_id, set_number, reps, weight_kg, completed)
        values (v_se, n, reps, w, true);
      end loop;
    end loop;
  end loop;
end $$;

-- Nutrition targets set by the coach
insert into public.nutrition_targets (client_id, calories, protein_g, carbs_g, fat_g, updated_by) values
  ('22222222-2222-2222-2222-222222222222', 2900, 180, 340, 85, '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', 2000, 160, 180, 65, '11111111-1111-1111-1111-111111111111');

-- Meals for the last 5 days
insert into public.meal_entries (client_id, entry_date, meal, food_name, serving, calories, protein_g, carbs_g, fat_g)
select c.id, current_date - dd, m.meal::public.meal_type, m.food || ' (Sample)', m.serving, m.kcal * c.scale, m.p * c.scale, m.c * c.scale, m.f * c.scale
from (values ('22222222-2222-2222-2222-222222222222'::uuid, 1.2), ('33333333-3333-3333-3333-333333333333'::uuid, 0.85)) c(id, scale)
cross join generate_series(0, 4) dd
cross join (values
  ('breakfast', 'Oats with whey and banana', '1 bowl', 520, 38, 75, 9),
  ('lunch', 'Chicken rice bowl', '1 bowl', 680, 52, 80, 14),
  ('snack', 'Greek yogurt with berries', '200 g', 210, 20, 22, 4),
  ('dinner', 'Salmon, potatoes and greens', '1 plate', 720, 45, 60, 30)
) m(meal, food, serving, kcal, p, c, f)
where not (dd = 0 and m.meal = 'dinner');

-- Body weight trend
insert into public.body_weights (client_id, entry_date, weight_kg)
select '22222222-2222-2222-2222-222222222222', current_date - g, 78.0 + (21 - g) * 0.04 + ((g % 3) - 1) * 0.15
from generate_series(0, 21, 2) g;
insert into public.body_weights (client_id, entry_date, weight_kg)
select '33333333-3333-3333-3333-333333333333', current_date - g, 86.0 - (14 - g) * 0.08 + ((g % 3) - 1) * 0.2
from generate_series(0, 14, 2) g;

-- Private coach notes
insert into public.coach_notes (coach_id, client_id, body, created_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Left shoulder tight on overhead work — watch elbow flare. (Sample)', now() - interval '10 days'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Bench moving well; consider top set + back-off next block. (Sample)', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Prefers morning sessions. Travel week coming up. (Sample)', now() - interval '5 days');

-- Conversations (server-time trigger paused so sample timestamps can be spread out)
alter table public.messages disable trigger messages_server_time;
insert into public.messages (id, conversation_id, sender_id, body, created_at)
select gen_random_uuid(), c.id, x.sender::uuid, x.body, now() - ((5 - x.ord) * interval '7 hours')
from public.conversations c
join (values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Welcome aboard! Your PPL block is live — start with Push on Monday. (Sample)', 1),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Thanks coach! Should I warm up before the first working set? (Sample)', 2),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Yes — 2–3 ramp-up sets, then your working sets. (Sample)', 3),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Hit 80 kg on bench today for 7! (Sample)', 4),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Hi Sam, targets are set at 2000 kcal. Log meals daily please. (Sample)', 1),
  ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Will do. Travelling next week, can I swap Lower for a hotel workout? (Sample)', 2)
) x(client, sender, body, ord) on x.client::uuid = c.client_id
order by x.ord;

alter table public.messages enable trigger messages_server_time;

-- Coach has read everything except the last client message in each thread
insert into public.conversation_reads (conversation_id, user_id, last_read_at)
select c.id, c.coach_id, now() - interval '30 hours' from public.conversations c;
insert into public.conversation_reads (conversation_id, user_id, last_read_at)
select c.id, c.client_id, now() from public.conversations c;
