/** Muscle regions — must match public.muscle_regions() in the database. */
export const MUSCLES = [
  "chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms",
  "abs", "obliques", "traps", "lats", "lower_back", "glutes", "quads", "hamstrings", "adductors", "calves",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: "Chest", front_delts: "Front delts", side_delts: "Side delts", rear_delts: "Rear delts",
  biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", abs: "Abs", obliques: "Obliques",
  traps: "Upper back / traps", lats: "Lats", lower_back: "Lower back", glutes: "Glutes",
  quads: "Quads", hamstrings: "Hamstrings", adductors: "Adductors", calves: "Calves",
};

export const muscleLabel = (m: string) => MUSCLE_LABEL[m as Muscle] ?? m;

export const PATTERNS = ["push", "pull", "squat", "hinge", "lunge", "carry", "core", "isolation"] as const;
export const EQUIPMENT = ["Barbell", "Dumbbell", "Machine", "Cable", "Smith", "Kettlebell", "Bodyweight", "Band"] as const;
export const ANGLES = ["flat", "incline", "decline"] as const;
export const GRIPS = ["overhand", "underhand", "neutral", "wide", "close"] as const;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
