import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-5 py-10">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">This link doesn&apos;t go anywhere. It may be old or mistyped.</p>
        <Link href="/" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand font-semibold text-brand-fg">
          Go to the app
        </Link>
      </div>
    </main>
  );
}
