"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      return setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
    }
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div><h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1><p className="mt-1 text-sm text-muted">Pick up where you left off.</p></div>
      {error && <ErrorBox message={error} />}
      <Field label="Email">
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" loading={loading} className="w-full">Log in</Button>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link className="font-semibold text-brand" href={`/signup${next.startsWith("/invite/") ? `?invite=${next.split("/")[2]}` : ""}`}>
          Create an account
        </Link>
      </p>
      {/* Only on local/demo setups: set NEXT_PUBLIC_SHOW_DEMO_LOGINS=true. Never in production. */}
      {process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "true" && (
        <div className="rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          <p className="font-semibold text-ink">Demo accounts (sample data)</p>
          <p>coach@demo.test · alex@demo.test · sam@demo.test. Password: <code>demo-pass-123</code></p>
        </div>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
