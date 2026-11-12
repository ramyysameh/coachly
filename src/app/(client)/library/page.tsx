"use client";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ExerciseLibraryPage from "@/components/ExerciseLibrary";
import { PageHeader } from "@/components/ui";

export default function ClientLibraryPage() {
  return (
    <div>
      <Link href="/training" className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted"><ChevronLeft className="size-4" /> Training</Link>
      <PageHeader title="Exercise library" subtitle="See which muscles each movement works and how to do it." />
      <ExerciseLibraryPage />
    </div>
  );
}
