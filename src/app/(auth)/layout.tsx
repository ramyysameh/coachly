import { Dumbbell } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-2 text-brand">
        <Dumbbell className="size-7" aria-hidden />
        <span className="text-2xl font-bold tracking-tight text-ink">Coachly</span>
      </div>
      {children}
    </main>
  );
}
