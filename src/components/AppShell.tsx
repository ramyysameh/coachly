"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BarChart3, CalendarCheck, ClipboardList, Dumbbell, LayoutDashboard, LogOut, MessageCircle, Salad, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

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

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <ProfileContext.Provider value={{ profile, unread, refreshUnread }}>
      <div className="min-h-dvh md:flex">
        {/* Desktop sidebar (coaches mainly use this) */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-white p-4 md:flex">
          <div className="mb-6 flex items-center gap-2 px-2 text-brand">
            <Dumbbell className="size-6" aria-hidden />
            <span className="text-xl font-bold text-ink">Coachly</span>
          </div>
          <nav className="flex-1 space-y-1" aria-label="Main">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium",
                  isActive(path, n.href) ? "bg-brand/10 text-brand-dark" : "text-muted hover:bg-paper hover:text-ink",
                )}
              >
                <n.icon className="size-5" aria-hidden />
                <span className="flex-1">{n.label}</span>
                {n.badge && unread > 0 && <UnreadDot count={unread} />}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line pt-3">
            <p className="truncate px-3 text-sm font-semibold">{profile.full_name || "Account"}</p>
            <p className="px-3 text-xs capitalize text-muted">{profile.role}</p>
            <button onClick={signOut} className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-muted hover:bg-paper">
              <LogOut className="size-5" aria-hidden /> Log out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-4 py-2 backdrop-blur md:hidden">
            <span className="flex items-center gap-2 font-bold text-ink">
              <Dumbbell className="size-5 text-brand" aria-hidden /> Coachly
            </span>
            <button onClick={signOut} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted" aria-label="Log out">
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </header>
          <main className="pb-nav mx-auto w-full max-w-5xl px-4 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
        </div>

        {/* Mobile bottom navigation */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white md:hidden"
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
                className={cn("relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", active ? "text-brand" : "text-muted")}
              >
                <n.icon className="size-6" aria-hidden />
                {n.label}
                {n.badge && unread > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2">
                    <UnreadDot count={unread} />
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </ProfileContext.Provider>
  );
}

function UnreadDot({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
