import { BarChart3, BookOpen, CalendarCheck, ClipboardList, Dumbbell, LayoutDashboard, MessageCircle, Salad, UserPlus, Users } from "lucide-react";

// The app's main destinations. Shared by AppShell's navs and the coach search's "Go to" group;
// kept free of component imports so both can use it without an import cycle.

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Dumbbell;
  badge?: boolean;
  /** Left out of the phone tab bar, which holds at most five items. Still in the sidebar and search. */
  sidebarOnly?: boolean;
  /** Other routes that count as this item for the active highlight (e.g. a sidebar-only page it links to). */
  alsoActive?: string[];
};

export const clientNav: NavItem[] = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/training", label: "Training", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Salad },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageCircle, badge: true },
];

export const coachNav: NavItem[] = [
  { href: "/coach", label: "Dashboard", icon: LayoutDashboard },
  // On phones, Invite is reached from the Clients page header, so Clients stays lit there.
  { href: "/coach/clients", label: "Clients", icon: Users, alsoActive: ["/coach/invite"] },
  { href: "/coach/plans", label: "Plans", icon: ClipboardList },
  { href: "/coach/library", label: "Library", icon: BookOpen },
  { href: "/coach/messages", label: "Messages", icon: MessageCircle, badge: true },
  { href: "/coach/invite", label: "Invite", icon: UserPlus, sidebarOnly: true },
];
