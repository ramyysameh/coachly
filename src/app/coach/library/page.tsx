"use client";
import ExerciseLibraryPage from "@/components/ExerciseLibrary";
import { PageHeader } from "@/components/ui";

export default function CoachLibraryPage() {
  return (
    <div>
      <PageHeader title="Exercise library" subtitle="Every exercise is a base movement with variants. Muscle tags drive weekly volume and the heat map." />
      <ExerciseLibraryPage canCreate />
    </div>
  );
}
