"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BarChart3, BookOpen, CalendarCheck, ClipboardList, Dumbbell, LayoutDashboard, LogOut, MessageCircle, Salad, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { BrandMark } from "@/components/ui";
import { ConfirmSheet, useSheet } from "@/components/Sheet";
import { clearOfflineData } from "@/lib/offline";
import { flushPendingSets, pendingSetCount } from "@/lib/pendingSets";
import { flushPendingMeals, pendingMealCount } from "@/lib/pendingMeals";

type Ctx = { profile: Profile; unread: number; refreshUnread: () => void };
const ProfileContext = createContext<Ctx | null>(null);

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside AppShell");
  return ctx;
}

type NavItem = { href: string; label: string; icon: typeof Dumbbell; badge?: boolean };

const clientNav: NavItem[] = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/training", label: "Training", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Salad },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageCircle, badge: true },
];

const coachNav: NavItem[] = [
  { href: "/coach", label: "Dashboard", icon: LayoutDashboard },
  { href: "/coach/clients", label: "Clients", icon: Users },
  { href: "/coach/plans", label: "Plans", icon: ClipboardList },
  { href: "/coach/library", label: "Library", icon: BookOpen },
  { href: "/coach/messages", label: "Messages", icon: MessageCircle, badge: true },
  { href: "/coach/invite", label: "Invite", icon: UserPlus },
];

function isActive(path: string, href: string) {
  if (href === "/coach") return path === "/coach";
  return path === href || path.startsWith(href + "/");
}

export default function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [unread, setUnread] = useState(0);
  const discard = useSheet<number>();
  const nav = profile.role === "coach" ? coachNav : clientNav;

  const refreshUnread = useCallback(async () => {
    const { data } = await supabase.rpc("unread_counts");
    setUnread(((data as { unread: number }[]) ?? []).reduce((s, r) => s + Number(r.unread), 0));
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUnread();
    const channel = supabase
      .channel(`unread-${profile.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => refreshUnread())
      // recount once live, in case a message landed before the subscription opened
      .subscribe((status: string) => status === "SUBSCRIBED" && refreshUnread());
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [supabase, profile.id, refreshUnread]);

  // Background sync: send anything logged offline as soon as we're online again.
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (profile.role !== "client") return;
    let busy = false;
    const sync = async () => {
      setOnline(navigator.onLine);
      if (busy || !navigator.onLine) return setPending(pendingSetCount() + pendingMealCount());
      busy = true;
      const before = pendingSetCount() + pendingMealCount();
      if (before) {
        await flushPendingSets(supabase);
        await flushPendingMeals(supabase);
        const after = pendingSetCount() + pendingMealCount();
        if (after < before) {
          window.dispatchEvent(new Event("coachly:synced"));
          notify.success(`${before - after} offline change(s) synced`);
        }
      }
      setPending(pendingSetCount() + pendingMealCount());
      busy = false;
    };
    sync();
    const goOffline = () => setOnline(false);
    const t = setInterval(sync, 30_000);
    window.addEventListener("online", sync);
    window.addEventListener("offline", goOffline);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", sync);
    };
  }, [supabase, profile.role]);

  async function signOut() {
    if (profile.role === "client") {
      await flushPendingSets(supabase);
      await flushPendingMeals(supabase);
      const left = pendingSetCount() + pendingMealCount();
      if (left) return discard.show(left);
    }
    await finishSignOut();
  }

  async function finishSignOut() {
    await clearOfflineData();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <ProfileContext.Provider value={{ profile, unread, refreshUnread }}>
      <div className="min-h-dvh md:flex">
        {/* Desktop sidebar (coaches mainly use this) */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
          <div className="mb-8 px-2">
            <BrandMark />
          </div>
          <nav className="flex-1 space-y-1" aria-label="Main">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(path, n.href) ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150",
                  isActive(path, n.href)
                    ? "bg-brand/10 text-brand-dark before:absolute before:inset-y-2.5 before:-left-4 before:w-1 before:rounded-r-full before:bg-brand"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <n.icon className="size-5" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">{n.label}</span>
                {n.badge && unread > 0 && <UnreadDot count={unread} />}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line pt-4">
            <div className="flex items-center gap-3 px-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink ring-1 ring-line">
                {initialsOf(profile.full_name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profile.full_name || "Account"}</p>
                <p className="text-xs capitalize text-muted">{profile.role}</p>
              </div>
            </div>
            <button onClick={signOut} className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <LogOut className="size-4.5" strokeWidth={1.75} aria-hidden /> Log out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header
            className="sticky top-0 z-20 flex items-center justify-between border-b border-line/70 bg-surface/80 px-4 py-2 backdrop-blur-xl backdrop-saturate-150 md:hidden"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <BrandMark compact />
            <button onClick={signOut} className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-muted active:bg-surface-2" aria-label="Log out">
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden /> Log out
            </button>
          </header>
          {(!online || pending > 0) && (
            <p className="flex animate-enter items-center justify-center gap-2 border-b border-warn-line bg-warn-bg px-4 py-2 text-center text-xs font-medium text-warn" role="status">
              {!online ? "Offline. You can keep logging; changes sync when you reconnect." : `Syncing ${pending} change(s) logged offline…`}
            </p>
          )}
          <main className="pb-nav mx-auto w-full max-w-5xl px-4 pt-5 md:px-10 md:pb-12 md:pt-10">{children}</main>
        </div>

        {/* Mobile bottom navigation */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line/70 bg-surface/85 backdrop-blur-xl backdrop-saturate-150 md:hidden"
          style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)`, paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Main"
        >
          {nav.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors duration-150",
                  active ? "text-brand-dark" : "text-muted active:text-ink",
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200", active && "bg-brand/12")}>
                  <n.icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.75} aria-hidden />
                </span>
                {n.label}
                {n.badge && unread > 0 && (
                  <span className="absolute top-1 left-1/2 ml-2.5">
                    <UnreadDot count={unread} />
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <ConfirmSheet
        {...discard.bind}
        title="Log out and discard changes?"
        description={`${discard.item ?? 0} change(s) logged offline haven't synced yet. Logging out now will discard them. Log out anyway?`}
        confirmLabel="Log out"
        onConfirm={finishSignOut}
      />
    </ProfileContext.Provider>
  );
}

function UnreadDot({ count }: { count: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 font-mono text-[10px] font-semibold text-white tabular-nums ring-2 ring-surface" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function initialsOf(name: string) {
  return name.split(" ").filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
