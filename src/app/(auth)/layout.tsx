import { BrandMark } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10">
      {/* soft brand wash behind the form; purely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_14%,transparent),transparent)]"
      />
      <div className="relative w-full max-w-[400px] animate-enter">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">{children}</div>
      </div>
    </main>
  );
}
