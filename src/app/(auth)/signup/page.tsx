"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

function SignupForm() {
  const router = useRouter();
  const invite = useSearchParams().get("invite");
  const [role, setRole] = useState<"coach" | "client">(invite ? "client" : "coach");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Enter your name.";
    if (!email.includes("@")) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Use at least 8 characters.";
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    setLoading(true);
    const next = invite ? `/invite/${invite}` : "/";
    const { data, error } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim(), role },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    setLoading(false);
    if (error) return setError(error.message);
    if (!data.session) return setInfo("Check your email to confirm your account, then log in.");
    router.replace(next);
    router.refresh();
  }

  if (info) return <p className="rounded-2xl border border-line bg-white p-4">{info}</p>;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-bold">Create your account</h1>
      {invite && <p className="rounded-xl bg-brand/10 p-3 text-sm text-brand-dark">You were invited by a coach. Create a client account to accept.</p>}
      {error && <ErrorBox message={error} />}
      {!invite && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {(["coach", "client"] as const).map((r) => (
            <button
              type="button"
              key={r}
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn("min-h-14 rounded-xl border-2 font-semibold capitalize", role === r ? "border-brand bg-brand/5 text-brand-dark" : "border-line bg-white text-muted")}
            >
              I&apos;m a {r}
            </button>
          ))}
        </div>
      )}
      {!invite && role === "client" && (
        <p className="text-xs text-muted">Clients usually join through their coach&apos;s invite link. You can still create an account and accept an invite later.</p>
      )}
      <Field label="Full name" error={errors.name}>
        <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email" error={errors.email}>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" error={errors.password} hint="At least 8 characters">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" loading={loading} className="w-full">Create account</Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link className="font-semibold text-brand" href={invite ? `/login?next=/invite/${invite}` : "/login"}>Log in</Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
