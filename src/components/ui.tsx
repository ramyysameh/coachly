"use client";
import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { AlertTriangle, Dumbbell, Loader2, RotateCw } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/*
 * Shape system: controls are rounded-xl, cards/panels rounded-2xl, pills/avatars rounded-full.
 * Press feedback: every pressable scales to 0.98 on :active (disabled excluded).
 */
const press = "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out enabled:active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg shadow-raised hover:bg-brand-dark disabled:bg-brand/45 disabled:shadow-none",
  secondary: "bg-surface text-ink border border-line shadow-card hover:border-muted/40 hover:bg-surface-2 disabled:opacity-50",
  ghost: "text-ink hover:bg-surface-2 disabled:opacity-50",
  danger: "bg-surface text-danger border border-danger-line hover:bg-danger-bg disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap select-none",
        press,
        size === "sm" && "min-h-10 px-3 text-sm",
        size === "md" && "min-h-12 px-4 text-[15px]",
        size === "lg" && "min-h-14 px-6 text-base",
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold whitespace-nowrap active:scale-[0.98]", press, variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs font-medium text-danger" role="alert">{error}</span>}
    </label>
  );
}

const inputCls =
  "w-full min-h-12 rounded-xl border border-line bg-surface px-3.5 text-base text-ink shadow-card placeholder:text-muted transition-[border-color,box-shadow] duration-150 hover:border-muted/40 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:bg-surface-2 disabled:text-muted";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

/** Numeric input that opens the number pad on phones. */
export function NumInput({ decimal, ...props }: InputHTMLAttributes<HTMLInputElement> & { decimal?: boolean }) {
  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      pattern={decimal ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}
      autoComplete="off"
      {...props}
      className={cn(inputCls, "px-2 text-center font-mono tabular-nums", props.className)}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, "pr-8", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "min-h-20 py-2.5", props.className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  // cn() only joins classes, so skip the default padding when the caller sets its own.
  const ownPadding = /(^|\s)p-\S+/.test(className ?? "");
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-card", !ownPadding && "p-4", className)}>{children}</div>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-surface-2", className)} aria-hidden />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex animate-enter items-start gap-3 rounded-2xl border border-danger-line bg-danger-bg p-4 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 inline-flex min-h-9 items-center gap-1.5 font-semibold underline underline-offset-2">
            <RotateCw className="size-3.5" aria-hidden /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex animate-enter flex-col items-center rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-12 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:size-6">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-[42ch] text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[26px] leading-tight font-semibold tracking-tight text-ink md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "warn" | "danger"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-line",
    brand: "bg-brand/10 text-brand-dark border-brand/20",
    warn: "bg-warn-bg text-warn border-warn-line",
    danger: "bg-danger-bg text-danger border-danger-line",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone])}>{children}</span>;
}

/** Progress bar for "logged vs target". */
export function Meter({ label, value, target, unit }: { label: string; value: number; target?: number | null; unit: string }) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = !!target && value > target * 1.05;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted">
          <span className={cn("text-sm font-semibold", over ? "text-warn" : "text-ink")}><NumberFlow value={Math.round(value)} /></span>
          {target ? `/${target}` : ""} {unit}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={target ?? undefined}
      >
        {target ? (
          <div
            className={cn("h-full origin-left rounded-full transition-transform duration-700 ease-out-quart", over ? "bg-warn-solid" : "bg-brand")}
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-10 shrink-0 flex-1 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
            value === o.value ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "md" | "lg" }) {
  const initials = name.split(" ").filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const dim = size === "lg" ? "size-20 text-2xl" : "size-10 text-sm";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn("shrink-0 rounded-full object-cover ring-1 ring-line", dim)} />;
  }
  return <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-brand/12 font-semibold text-brand-dark ring-1 ring-brand/15", dim)}>{initials || "?"}</span>;
}

export function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={cn("flex items-center justify-center rounded-[10px] bg-brand text-brand-fg shadow-raised", compact ? "size-7" : "size-8")}>
        <Dumbbell className={compact ? "size-4" : "size-[18px]"} strokeWidth={2.25} aria-hidden />
      </span>
      <span className={cn("font-semibold tracking-tight text-ink", compact ? "text-base" : "text-lg")}>Coachly</span>
    </span>
  );
}

/** Full-screen centred layout for auth, invite and status pages: brand mark over a single card. */
export function CenteredPage({ children, card = true, role }: { children: ReactNode; card?: boolean; role?: string }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10" role={role}>
      {/* soft brand wash behind the content; purely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_14%,transparent),transparent)]"
      />
      <div className="relative w-full max-w-[400px] animate-enter">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        {card ? <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">{children}</div> : children}
      </div>
    </main>
  );
}

/** Icon tile used at the top of status cards (offline, errors, not found). */
export function StatusIcon({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-full [&_svg]:size-6",
        tone === "warn" ? "bg-warn-bg text-warn" : "bg-surface-2 text-muted",
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}
