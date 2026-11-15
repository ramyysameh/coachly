-- Exercise library audit + expansion.
--   1. Fixes to existing built-ins (wrong movement, wrong equipment, missing flags).
--   2. New base movements for gaps in the library (shrugs, hip abduction, pullovers, ...).
--   3. Equipment / angle / grip variants of each movement, so a coach can program
--      "flat chest press" and pick dumbbell, barbell, machine, Smith or cable.
--   4. A unique index so built-in names can't be duplicated.
-- Everything is idempotent: re-running inserts nothing twice.

-- ───────────────────────── Fixes ─────────────────────────
-- Kettlebell swings are a ballistic hinge, not a hip thrust.
insert into public.movements (name, pattern)
select v.name, v.pattern from (values
  ('Swing', 'hinge'), ('Good morning', 'hinge'), ('Back extension', 'hinge'),
  ('Front raise', 'isolation'), ('Upright row', 'pull'), ('Shrug', 'isolation'),
  ('Pullover', 'pull'), ('Step-up', 'lunge'), ('Hip abduction', 'isolation'),
  ('Hip adduction', 'isolation'), ('Glute kickback', 'isolation'), ('Wrist curl', 'isolation'),
  ('Rotation', 'core'), ('Anti-rotation', 'core')
) as v(name, pattern)
where not exists (select 1 from public.movements m where lower(m.name) = lower(v.name) and m.created_by is null);

update public.exercises set movement_id = (select id from public.movements where name = 'Swing' and created_by is null)
where name = 'Kettlebell Swing' and created_by is null;

-- Skull crushers and preacher curls are done with an EZ bar in almost every gym.
update public.exercises set equipment = 'EZ Bar' where created_by is null and name in ('Skull Crusher', 'Preacher Curl');
-- Face pulls use a rope, so a neutral grip.
update public.exercises set grip = 'neutral' where created_by is null and name = 'Face Pull';
-- Legacy group label: RDLs sit with the other deadlifts; carries are a full-body/grip movement.
update public.exercises set muscle_group = 'Back' where created_by is null and name = 'Romanian Deadlift';
update public.exercises set timed = true where created_by is null and name in ('Plank', 'Farmer''s Carry');

-- ───────────────────────── New variants ─────────────────────────
insert into public.exercises (name, muscle_group, equipment, is_bodyweight, timed, movement_id, angle, grip, unilateral,
                              primary_muscles, secondary_muscles, cues, mistakes)
select v.name, v.grp, v.equip, v.bw, v.timed, m.id, v.angle, v.grip, v.uni, v.pm, v.sm, v.cues, v.mis
from (values
  -- Chest press
  ('Incline Machine Press', 'Chest', 'Machine', 'Chest press', 'incline'::text, null::text, false, false, false,
    '{chest,front_delts}'::text[], '{triceps}'::text[], '{"Seat so the handles line up with the upper chest","Press up and in"}'::text[], '{}'::text[]),
  ('Incline Smith Machine Press', 'Chest', 'Smith', 'Chest press', 'incline', null, false, false, false,
    '{chest,front_delts}', '{triceps}', '{"Bench at 30°, bar over the upper chest","Set the safeties first"}', '{}'),
  ('Decline Dumbbell Press', 'Chest', 'Dumbbell', 'Chest press', 'decline', null, false, false, false,
    '{chest}', '{triceps,front_delts}', '{"Hook the legs in before you lie back","Lower to the lower chest"}', '{}'),
  ('Cable Chest Press', 'Chest', 'Cable', 'Chest press', 'flat', null, false, false, false,
    '{chest}', '{front_delts,triceps}', '{"Staggered stance, slight forward lean","Handles meet at mid-chest"}', '{}'),
  ('Dumbbell Floor Press', 'Chest', 'Dumbbell', 'Chest press', 'flat', null, false, false, false,
    '{chest,triceps}', '{front_delts}', '{"Pause when the upper arms touch the floor","Elbows about 45° from the body"}', '{"Bouncing the elbows off the floor"}'),
  ('Close-Grip Dumbbell Press', 'Chest', 'Dumbbell', 'Chest press', 'flat', 'neutral', false, false, false,
    '{triceps,chest}', '{front_delts}', '{"Dumbbells touching, palms facing","Elbows tucked"}', '{}'),
  ('Landmine Press', 'Shoulders', 'Barbell', 'Shoulder press', null, 'neutral', true, false, false,
    '{front_delts,chest}', '{triceps,abs}', '{"Press up and slightly forward","Brace so the torso doesn''t twist"}', '{}'),
  -- Chest fly
  ('Pec Deck', 'Chest', 'Machine', 'Chest fly', 'flat', null, false, false, false,
    '{chest}', '{front_delts}', '{"Handles at chest height","Squeeze for a second at the middle"}', '{"Letting the shoulders roll forward"}'),
  ('Incline Dumbbell Fly', 'Chest', 'Dumbbell', 'Chest fly', 'incline', null, false, false, false,
    '{chest,front_delts}', '{}', '{"Bench at 30°","Soft elbows, wide arc"}', '{}'),
  ('Low-to-High Cable Fly', 'Chest', 'Cable', 'Chest fly', 'incline', null, false, false, false,
    '{chest,front_delts}', '{}', '{"Pulleys at the bottom","Sweep up to eye height"}', '{}'),
  ('High-to-Low Cable Fly', 'Chest', 'Cable', 'Chest fly', 'decline', null, false, false, false,
    '{chest}', '{front_delts}', '{"Pulleys at the top","Hands meet at the belly button"}', '{}'),
  -- Push-up
  ('Incline Push-Up', 'Chest', 'Bodyweight', 'Push-up', 'incline', null, false, true, false,
    '{chest}', '{triceps,front_delts}', '{"Hands on a bench or box","Body in one straight line"}', '{}'),
  ('Decline Push-Up', 'Chest', 'Bodyweight', 'Push-up', 'decline', null, false, true, false,
    '{chest,front_delts}', '{triceps,abs}', '{"Feet on a bench","Chest to the floor"}', '{"Hips piking up"}'),
  ('Diamond Push-Up', 'Triceps', 'Bodyweight', 'Push-up', null, 'close', false, true, false,
    '{triceps,chest}', '{front_delts}', '{"Thumbs and index fingers touching","Elbows brush the ribs"}', '{}'),
  -- Dip
  ('Assisted Dip', 'Chest', 'Machine', 'Dip', null, null, false, false, false,
    '{chest,triceps}', '{front_delts}', '{"More weight = more help","Lower until shoulders pass the elbows"}', '{}'),
  ('Bench Dip', 'Triceps', 'Bodyweight', 'Dip', null, null, false, true, false,
    '{triceps}', '{front_delts,chest}', '{"Hips close to the bench","Bend the elbows to 90°"}', '{"Shoulders rolling forward"}'),
  -- Shoulder press
  ('Standing Dumbbell Shoulder Press', 'Shoulders', 'Dumbbell', 'Shoulder press', null, null, false, false, false,
    '{front_delts}', '{side_delts,triceps,abs}', '{"Squeeze glutes and brace","Press straight up, biceps by the ears"}', '{"Leaning back"}'),
  ('Smith Machine Shoulder Press', 'Shoulders', 'Smith', 'Shoulder press', null, null, false, false, false,
    '{front_delts}', '{side_delts,triceps}', '{"Bench just behind the bar","Lower to chin height"}', '{}'),
  ('Kettlebell Overhead Press', 'Shoulders', 'Kettlebell', 'Shoulder press', null, 'neutral', true, false, false,
    '{front_delts}', '{side_delts,triceps,abs}', '{"Bell rests on the forearm","Punch straight up"}', '{}'),
  -- Lateral raise
  ('Cable Lateral Raise', 'Shoulders', 'Cable', 'Lateral raise', null, null, true, false, false,
    '{side_delts}', '{traps}', '{"Cable crosses in front of the body","Lead with the elbow"}', '{}'),
  ('Machine Lateral Raise', 'Shoulders', 'Machine', 'Lateral raise', null, null, false, false, false,
    '{side_delts}', '{traps}', '{"Pads on the outside of the elbows","Stop at shoulder height"}', '{}'),
  -- Front raise
  ('Dumbbell Front Raise', 'Shoulders', 'Dumbbell', 'Front raise', null, 'overhand', false, false, false,
    '{front_delts}', '{side_delts}', '{"Raise to eye height","No swinging"}', '{}'),
  ('Cable Front Raise', 'Shoulders', 'Cable', 'Front raise', null, 'overhand', false, false, false,
    '{front_delts}', '{side_delts}', '{"Stand facing away from the pulley","Arms straight, soft elbows"}', '{}'),
  -- Rear delt
  ('Reverse Pec Deck', 'Shoulders', 'Machine', 'Rear delt', null, 'neutral', false, false, false,
    '{rear_delts}', '{traps}', '{"Chest on the pad","Sweep the arms back, not down"}', '{}'),
  ('Cable Rear Delt Fly', 'Shoulders', 'Cable', 'Rear delt', null, null, false, false, false,
    '{rear_delts}', '{traps}', '{"Cross the cables at chest height","Pull out wide"}', '{}'),
  ('Band Face Pull', 'Shoulders', 'Band', 'Rear delt', null, 'neutral', false, false, false,
    '{rear_delts}', '{traps}', '{"Pull towards the forehead","Thumbs point back at the end"}', '{}'),
  -- Upright row / shrug
  ('Cable Upright Row', 'Shoulders', 'Cable', 'Upright row', null, 'overhand', false, false, false,
    '{side_delts,traps}', '{biceps}', '{"Elbows lead, higher than the hands","Stop at chest height"}', '{"Pulling to the chin with a narrow grip"}'),
  ('Dumbbell Upright Row', 'Shoulders', 'Dumbbell', 'Upright row', null, 'overhand', false, false, false,
    '{side_delts,traps}', '{biceps}', '{"Elbows out and up","Stop at chest height"}', '{}'),
  ('Barbell Shrug', 'Back', 'Barbell', 'Shrug', null, 'overhand', false, false, false,
    '{traps}', '{forearms}', '{"Shoulders straight up to the ears","Pause at the top"}', '{"Rolling the shoulders"}'),
  ('Dumbbell Shrug', 'Back', 'Dumbbell', 'Shrug', null, 'neutral', false, false, false,
    '{traps}', '{forearms}', '{"Arms long","Pause at the top"}', '{}'),
  ('Trap Bar Shrug', 'Back', 'Trap Bar', 'Shrug', null, 'neutral', false, false, false,
    '{traps}', '{forearms}', '{"Stand in the middle of the bar","Straight up, no rolling"}', '{}'),
  -- Triceps extension
  ('Rope Pushdown', 'Triceps', 'Cable', 'Triceps extension', null, 'neutral', false, false, false,
    '{triceps}', '{}', '{"Elbows pinned","Spread the rope at the bottom"}', '{"Leaning over the rope"}'),
  ('Single-Arm Cable Pushdown', 'Triceps', 'Cable', 'Triceps extension', null, 'underhand', true, false, false,
    '{triceps}', '{}', '{"Elbow by the side","Full lockout"}', '{}'),
  ('Cable Overhead Triceps Extension', 'Triceps', 'Cable', 'Triceps extension', null, 'neutral', false, false, false,
    '{triceps}', '{}', '{"Face away from the pulley","Elbows point forward, deep stretch"}', '{"Elbows flaring wide"}'),
  ('Dumbbell Skull Crusher', 'Triceps', 'Dumbbell', 'Triceps extension', null, 'neutral', false, false, false,
    '{triceps}', '{}', '{"Lower beside the head","Upper arms stay still"}', '{}'),
  ('Dumbbell Kickback', 'Triceps', 'Dumbbell', 'Triceps extension', null, 'neutral', true, false, false,
    '{triceps}', '{rear_delts}', '{"Upper arm parallel to the floor","Squeeze at lockout"}', '{"Swinging the upper arm"}'),
  ('Machine Triceps Extension', 'Triceps', 'Machine', 'Triceps extension', null, null, false, false, false,
    '{triceps}', '{}', '{"Elbows in line with the machine''s pivot"}', '{}'),
  -- Curl
  ('EZ-Bar Curl', 'Biceps', 'EZ Bar', 'Curl', null, 'underhand', false, false, false,
    '{biceps}', '{forearms}', '{"Grip on the angled part of the bar","Elbows stay by your sides"}', '{"Swinging the hips"}'),
  ('Cable Curl', 'Biceps', 'Cable', 'Curl', null, 'underhand', false, false, false,
    '{biceps}', '{forearms}', '{"Step back for tension at the bottom","Squeeze at the top"}', '{}'),
  ('Incline Dumbbell Curl', 'Biceps', 'Dumbbell', 'Curl', 'incline', 'underhand', false, false, false,
    '{biceps}', '{forearms}', '{"Bench at 45–60°","Arms hang straight down"}', '{"Shoulders rolling forward"}'),
  ('Concentration Curl', 'Biceps', 'Dumbbell', 'Curl', null, 'underhand', true, false, false,
    '{biceps}', '{}', '{"Elbow against the inner thigh","Slow lowering"}', '{}'),
  ('Machine Preacher Curl', 'Biceps', 'Machine', 'Curl', null, 'underhand', false, false, false,
    '{biceps}', '{forearms}', '{"Armpits on the pad","Full stretch at the bottom"}', '{}'),
  ('Bayesian Cable Curl', 'Biceps', 'Cable', 'Curl', null, 'underhand', true, false, false,
    '{biceps}', '{}', '{"Face away from the pulley","Arm starts behind the body"}', '{}'),
  ('Rope Hammer Curl', 'Biceps', 'Cable', 'Curl', null, 'neutral', false, false, false,
    '{biceps,forearms}', '{}', '{"Thumbs up","Elbows stay still"}', '{}'),
  ('Reverse Curl', 'Biceps', 'EZ Bar', 'Curl', null, 'overhand', false, false, false,
    '{forearms,biceps}', '{}', '{"Overhand grip","Wrists stay straight"}', '{}'),
  -- Wrist curl
  ('Dumbbell Wrist Curl', 'Forearms', 'Dumbbell', 'Wrist curl', null, 'underhand', false, false, false,
    '{forearms}', '{}', '{"Forearms on the thighs or a bench","Let the dumbbell roll to the fingers"}', '{}'),
  ('Reverse Wrist Curl', 'Forearms', 'Dumbbell', 'Wrist curl', null, 'overhand', false, false, false,
    '{forearms}', '{}', '{"Forearms supported","Light weight, full range"}', '{}'),
  -- Deadlift / hinge
  ('Trap Bar Deadlift', 'Back', 'Trap Bar', 'Deadlift', null, 'neutral', false, false, false,
    '{glutes,quads,hamstrings}', '{lower_back,traps,forearms}', '{"Stand in the centre of the bar","Push the floor away"}', '{"Rounding the lower back"}'),
  ('Sumo Deadlift', 'Back', 'Barbell', 'Deadlift', null, null, false, false, false,
    '{glutes,adductors,hamstrings}', '{quads,lower_back,traps,forearms}', '{"Wide stance, toes out","Knees track over the toes","Chest up"}', '{"Hips rising first"}'),
  ('Dumbbell Romanian Deadlift', 'Back', 'Dumbbell', 'Deadlift', null, 'neutral', false, false, false,
    '{hamstrings,glutes}', '{lower_back,forearms}', '{"Dumbbells slide down the thighs","Hips back, soft knees"}', '{"Squatting it down"}'),
  ('Single-Leg Romanian Deadlift', 'Back', 'Dumbbell', 'Deadlift', null, 'neutral', true, false, false,
    '{hamstrings,glutes}', '{lower_back,adductors}', '{"Hips square to the floor","Back leg in line with the torso"}', '{"Hip opening up"}'),
  ('Barbell Good Morning', 'Back', 'Barbell', 'Good morning', null, null, false, false, false,
    '{hamstrings,lower_back}', '{glutes}', '{"Bar on the upper back","Hips back until the torso is near parallel"}', '{"Rounding the back"}'),
  ('45° Back Extension', 'Back', 'Bodyweight', 'Back extension', null, null, false, true, false,
    '{lower_back,glutes}', '{hamstrings}', '{"Pad just below the hips","Hold a plate to add load"}', '{"Hyperextending at the top"}'),
  ('Reverse Hyperextension', 'Back', 'Machine', 'Back extension', null, null, false, false, false,
    '{glutes,lower_back}', '{hamstrings}', '{"Swing the legs up with the glutes","Control the way down"}', '{}'),
  ('Cable Pull-Through', 'Glutes', 'Cable', 'Swing', null, 'neutral', false, false, false,
    '{glutes,hamstrings}', '{lower_back}', '{"Face away from a low pulley","Hinge, then snap the hips through"}', '{"Squatting instead of hinging"}'),
  -- Row
  ('Chest-Supported Dumbbell Row', 'Back', 'Dumbbell', 'Row', 'incline', 'neutral', false, false, false,
    '{lats,traps}', '{rear_delts,biceps}', '{"Chest on an incline bench","Pull the elbows back to the hips"}', '{}'),
  ('Single-Arm Cable Row', 'Back', 'Cable', 'Row', null, 'neutral', true, false, false,
    '{lats}', '{traps,rear_delts,biceps}', '{"Reach long at the front","Elbow to the hip"}', '{}'),
  ('Wide-Grip Cable Row', 'Back', 'Cable', 'Row', null, 'wide', false, false, false,
    '{traps,rear_delts}', '{lats,biceps}', '{"Elbows out at 45°","Pull to the upper stomach"}', '{}'),
  ('Underhand Barbell Row', 'Back', 'Barbell', 'Row', null, 'underhand', false, false, false,
    '{lats}', '{biceps,traps,lower_back}', '{"Torso near 45°","Pull to the belly button"}', '{}'),
  ('Smith Machine Row', 'Back', 'Smith', 'Row', null, 'overhand', false, false, false,
    '{lats,traps}', '{rear_delts,biceps}', '{"Flat back, torso near 45°","Pull to the lower ribs"}', '{}'),
  ('Inverted Row', 'Back', 'Bodyweight', 'Row', null, 'overhand', false, true, false,
    '{lats,traps}', '{rear_delts,biceps}', '{"Body in a straight line","Chest to the bar"}', '{"Hips sagging"}'),
  ('Kettlebell Row', 'Back', 'Kettlebell', 'Row', null, 'neutral', true, false, false,
    '{lats}', '{traps,rear_delts,biceps}', '{"Hinge with a flat back","Elbow to the hip"}', '{}'),
  -- Pull-up / pulldown / pullover
  ('Assisted Pull-Up', 'Back', 'Machine', 'Pull-up', null, 'overhand', false, false, false,
    '{lats}', '{biceps,traps}', '{"More weight = more help","Chest to the bar"}', '{}'),
  ('Neutral-Grip Pull-Up', 'Back', 'Bodyweight', 'Pull-up', null, 'neutral', false, true, false,
    '{lats}', '{biceps,traps,forearms}', '{"Palms facing each other","Dead hang to chin over"}', '{}'),
  ('Machine Pulldown', 'Back', 'Machine', 'Lat pulldown', null, 'neutral', false, false, false,
    '{lats}', '{biceps,traps}', '{"Thighs locked under the pad","Elbows down to the ribs"}', '{}'),
  ('Band-Assisted Pull-Up', 'Back', 'Band', 'Pull-up', null, 'overhand', false, true, false,
    '{lats}', '{biceps,traps}', '{"Knee or foot in the band","Thicker band = more help"}', '{}'),
  ('Straight-Arm Cable Pulldown', 'Back', 'Cable', 'Pullover', null, 'overhand', false, false, false,
    '{lats}', '{triceps,rear_delts}', '{"Arms straight, slight forward lean","Sweep the bar to the thighs"}', '{"Bending the elbows"}'),
  ('Dumbbell Pullover', 'Back', 'Dumbbell', 'Pullover', null, 'neutral', false, false, false,
    '{lats,chest}', '{triceps}', '{"Lie across or along a bench","Big stretch behind the head"}', '{}'),
  -- Squat
  ('Pendulum Squat', 'Legs', 'Machine', 'Squat', null, null, false, false, false,
    '{quads}', '{glutes,adductors}', '{"Feet low on the platform for more quads","Go deep"}', '{}'),
  ('Belt Squat', 'Legs', 'Machine', 'Squat', null, null, false, false, false,
    '{quads,glutes}', '{adductors}', '{"Stay upright","Knees track over the toes"}', '{}'),
  ('Kettlebell Goblet Squat', 'Legs', 'Kettlebell', 'Squat', null, null, false, false, false,
    '{quads,glutes}', '{abs,adductors}', '{"Hold the bell by the horns at the chest","Elbows inside the knees"}', '{}'),
  ('Box Squat', 'Legs', 'Barbell', 'Squat', null, null, false, false, false,
    '{quads,glutes}', '{hamstrings,adductors,lower_back}', '{"Sit back to the box","Stay tight, don''t relax on the box"}', '{"Crashing onto the box"}'),
  ('Sissy Squat', 'Legs', 'Bodyweight', 'Squat', null, null, false, true, false,
    '{quads}', '{}', '{"Hold onto something for balance","Knees forward, hips stay extended"}', '{}'),
  -- Leg press
  ('Single-Leg Leg Press', 'Legs', 'Machine', 'Leg press', null, null, true, false, false,
    '{quads,glutes}', '{adductors}', '{"Foot in the middle of the platform","Lower back stays on the pad"}', '{}'),
  -- Lunge / step-up
  ('Reverse Lunge', 'Legs', 'Dumbbell', 'Lunge', null, null, true, false, false,
    '{quads,glutes}', '{adductors,hamstrings}', '{"Step back, front shin vertical","Drive through the front heel"}', '{}'),
  ('Barbell Lunge', 'Legs', 'Barbell', 'Lunge', null, null, true, false, false,
    '{quads,glutes}', '{adductors,hamstrings,abs}', '{"Bar on the upper back","Long stride"}', '{}'),
  ('Smith Machine Split Squat', 'Legs', 'Smith', 'Lunge', null, null, true, false, false,
    '{quads,glutes}', '{adductors}', '{"Front foot slightly in front of the bar","Straight down and up"}', '{}'),
  ('Lateral Lunge', 'Legs', 'Dumbbell', 'Lunge', null, null, true, false, false,
    '{adductors,glutes,quads}', '{}', '{"Step wide, sit into one hip","Other leg stays straight"}', '{}'),
  ('Bodyweight Lunge', 'Legs', 'Bodyweight', 'Lunge', null, null, true, true, false,
    '{quads,glutes}', '{adductors}', '{"Back knee kisses the floor","Torso tall"}', '{}'),
  ('Dumbbell Step-Up', 'Legs', 'Dumbbell', 'Step-up', null, null, true, false, false,
    '{quads,glutes}', '{adductors,hamstrings}', '{"Whole foot on the box","Don''t push off the back foot"}', '{}'),
  -- Leg extension / curl
  ('Single-Leg Extension', 'Legs', 'Machine', 'Leg extension', null, null, true, false, false,
    '{quads}', '{}', '{"Pause at the top","Slow on the way down"}', '{}'),
  ('Seated Leg Curl', 'Legs', 'Machine', 'Leg curl', null, null, false, false, false,
    '{hamstrings}', '{calves}', '{"Lap pad tight on the thighs","Lean forward slightly for a bigger stretch"}', '{}'),
  ('Standing Single-Leg Curl', 'Legs', 'Machine', 'Leg curl', null, null, true, false, false,
    '{hamstrings}', '{calves}', '{"Hips against the pad","Squeeze at the top"}', '{}'),
  ('Nordic Curl', 'Legs', 'Bodyweight', 'Leg curl', null, null, false, true, false,
    '{hamstrings}', '{calves,glutes}', '{"Ankles anchored","Lower as slowly as you can"}', '{"Bending at the hips"}'),
  -- Glutes
  ('Glute Bridge', 'Glutes', 'Bodyweight', 'Hip thrust', null, null, false, true, false,
    '{glutes}', '{hamstrings}', '{"Heels close to the hips","Squeeze at the top"}', '{}'),
  ('Single-Leg Hip Thrust', 'Glutes', 'Bodyweight', 'Hip thrust', null, null, true, true, false,
    '{glutes}', '{hamstrings}', '{"Upper back on the bench","Hips stay level"}', '{}'),
  ('Machine Hip Thrust', 'Glutes', 'Machine', 'Hip thrust', null, null, false, false, false,
    '{glutes}', '{hamstrings}', '{"Belt across the hip crease","Full lockout"}', '{}'),
  ('Smith Machine Hip Thrust', 'Glutes', 'Smith', 'Hip thrust', null, null, false, false, false,
    '{glutes}', '{hamstrings}', '{"Pad the bar","Chin tucked, ribs down"}', '{}'),
  ('Machine Hip Abduction', 'Glutes', 'Machine', 'Hip abduction', null, null, false, false, false,
    '{glutes}', '{}', '{"Lean forward slightly for more glute","Pause at the widest point"}', '{}'),
  ('Cable Hip Abduction', 'Glutes', 'Cable', 'Hip abduction', null, null, true, false, false,
    '{glutes}', '{}', '{"Cuff on the outside ankle","Lead with the heel"}', '{}'),
  ('Banded Lateral Walk', 'Glutes', 'Band', 'Hip abduction', null, null, false, true, false,
    '{glutes}', '{quads}', '{"Band above the knees","Stay low, toes forward"}', '{}'),
  ('Machine Hip Adduction', 'Legs', 'Machine', 'Hip adduction', null, null, false, false, false,
    '{adductors}', '{}', '{"Sit tall","Control the stretch"}', '{}'),
  ('Copenhagen Plank', 'Legs', 'Bodyweight', 'Hip adduction', null, null, true, true, true,
    '{adductors}', '{obliques,abs}', '{"Top leg on the bench","Body in one straight line"}', '{"Hips dropping"}'),
  ('Cable Glute Kickback', 'Glutes', 'Cable', 'Glute kickback', null, null, true, false, false,
    '{glutes}', '{hamstrings}', '{"Hinge forward slightly","Kick back, not up"}', '{"Arching the lower back"}'),
  ('Machine Glute Kickback', 'Glutes', 'Machine', 'Glute kickback', null, null, true, false, false,
    '{glutes}', '{hamstrings}', '{"Chest on the pad","Squeeze at full hip extension"}', '{}'),
  -- Calves
  ('Seated Calf Raise', 'Calves', 'Machine', 'Calf raise', null, null, false, false, false,
    '{calves}', '{}', '{"Pad low on the thighs","Full stretch, pause at the top"}', '{"Bouncing"}'),
  ('Leg Press Calf Raise', 'Calves', 'Machine', 'Calf raise', null, null, false, false, false,
    '{calves}', '{}', '{"Balls of the feet on the platform edge","Knees soft but locked in place"}', '{}'),
  ('Smith Machine Calf Raise', 'Calves', 'Smith', 'Calf raise', null, null, false, false, false,
    '{calves}', '{}', '{"Stand on a plate or step","Full range"}', '{}'),
  ('Single-Leg Calf Raise', 'Calves', 'Dumbbell', 'Calf raise', null, null, true, false, false,
    '{calves}', '{}', '{"Hold a wall for balance","Pause at the bottom"}', '{}'),
  -- Core
  ('Side Plank', 'Core', 'Bodyweight', 'Plank', null, null, true, true, true,
    '{obliques}', '{abs,glutes}', '{"Elbow under the shoulder","Hips high"}', '{"Hips sagging"}'),
  ('Hollow Hold', 'Core', 'Bodyweight', 'Plank', null, null, false, true, true,
    '{abs}', '{}', '{"Lower back pressed into the floor","Arms and legs long"}', '{"Lower back lifting"}'),
  ('Lying Leg Raise', 'Core', 'Bodyweight', 'Leg raise', null, null, false, true, false,
    '{abs}', '{}', '{"Hands under the hips","Lower slowly"}', '{"Arching the lower back"}'),
  ('Captain''s Chair Leg Raise', 'Core', 'Machine', 'Leg raise', null, null, false, true, false,
    '{abs}', '{obliques}', '{"Back against the pad","Curl the pelvis up"}', '{}'),
  ('Crunch', 'Core', 'Bodyweight', 'Crunch', null, null, false, true, false,
    '{abs}', '{}', '{"Ribs towards the hips","Lower back stays down"}', '{"Pulling on the neck"}'),
  ('Machine Crunch', 'Core', 'Machine', 'Crunch', null, null, false, false, false,
    '{abs}', '{obliques}', '{"Crunch, don''t pull with the arms"}', '{}'),
  ('Decline Sit-Up', 'Core', 'Bodyweight', 'Crunch', 'decline', null, false, true, false,
    '{abs}', '{obliques}', '{"Feet hooked","Control the way down"}', '{}'),
  ('Cable Woodchop', 'Core', 'Cable', 'Rotation', null, null, true, false, false,
    '{obliques}', '{abs}', '{"Rotate through the upper back","Arms stay long"}', '{}'),
  ('Russian Twist', 'Core', 'Bodyweight', 'Rotation', null, null, false, true, false,
    '{obliques}', '{abs}', '{"Lean back, chest tall","Hold a plate to add load"}', '{"Moving only the arms"}'),
  ('Pallof Press', 'Core', 'Cable', 'Anti-rotation', null, null, true, false, false,
    '{obliques,abs}', '{}', '{"Stand side-on to the pulley","Press out and don''t let it turn you"}', '{}'),
  -- Carry
  ('Suitcase Carry', 'Core', 'Dumbbell', 'Carry', null, 'neutral', true, false, true,
    '{obliques,forearms}', '{traps,abs}', '{"Weight in one hand","Don''t lean towards it"}', '{}'),
  ('Trap Bar Carry', 'Core', 'Trap Bar', 'Carry', null, 'neutral', false, false, true,
    '{forearms,traps}', '{abs,glutes}', '{"Stand tall","Short, quick steps"}', '{}')
) as v(name, grp, equip, movement, angle, grip, uni, bw, timed, pm, sm, cues, mis)
join public.movements m on m.name = v.movement and m.created_by is null
where not exists (select 1 from public.exercises e where lower(e.name) = lower(v.name) and e.created_by is null);

-- ───────────────────────── Guard ─────────────────────────
create unique index if not exists exercises_builtin_name on public.exercises (lower(name)) where created_by is null;
