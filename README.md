# Coachly — training & nutrition coaching

A mobile-first web app for personal trainers and their clients.

- **Coaches** invite clients with private expiring links, build reusable training splits, assign them from a start date, set nutrition targets, review workout/meal/body-weight logs, keep private notes and message clients.
- **Clients** see today's workout, log sets from their phone (numeric keypad, previous performance visible, resumable sessions), log meals against targets, track progress, and chat privately with their coach.

Stack: **Next.js 16 (App Router) + TypeScript + Tailwind 4**, **Supabase** (Auth, Postgres with row level security, Realtime).

## Setup

Requirements: Node 20+, Docker Desktop (for the local Supabase stack).

```bash
npm install
npx supabase start          # starts Postgres, Auth, Realtime locally; applies migrations + seed
cp .env.example .env.local  # then paste the values printed by `supabase start`
npm run dev                 # http://localhost:3000
```

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<"anon key" / "Publishable" key from `npx supabase status`>
```

Reset the database (re-runs migrations and seed): `npx supabase db reset`.

### Using a hosted Supabase project instead

1. Create a project at supabase.com and copy its URL + anon key into `.env.local`.
2. `npx supabase link --project-ref <ref>` then `npx supabase db push` (applies `supabase/migrations`).
3. Optionally load demo data: run `supabase/seed.sql` in the SQL editor.
4. In Auth → URL configuration, set the site URL to your app URL.

## Production

- **Live app:** https://coachly-gules.vercel.app (Vercel project `coachly`, region `fra1`). Every push to `master` deploys automatically; other branches get preview URLs.
- **Database/auth:** Supabase project `coachly` (`kvlwmpfzgkdopjjlcswi`, Central EU / Frankfurt). No demo data is loaded there.
- **Env vars on Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key), and `SUPABASE_DB_URL` (Production only, see below). `NEXT_PUBLIC_SHOW_DEMO_LOGINS` is intentionally unset.
- **Auth URLs:** site URL is the live app; redirects allowed for the live app, Vercel previews and `http://localhost:3000`.
- **New migrations apply automatically.** `npm run build` first runs `scripts/migrate-on-deploy.mjs`: on Vercel production builds it runs `supabase db push` against `SUPABASE_DB_URL`, so the database is migrated before the new code goes live. If a migration fails, the build fails and the current deployment stays live. Preview and local builds skip it. `SUPABASE_DB_URL` is the **Session pooler** connection string from Supabase → Connect (IPv4; Vercel can't reach the IPv6-only direct connection). Never commit it — the repository is public.
- **Manual fallback:** `npx supabase link --project-ref kvlwmpfzgkdopjjlcswi` once, then `npx supabase db push --remote`. Applied migrations are recorded in `supabase_migrations.schema_migrations`.

## Demo accounts (sample data)

All passwords: `demo-pass-123`. Seeded data is labelled "(Sample)" and dated relative to the day you seed.

| Email | Role | Notes |
| --- | --- | --- |
| coach@demo.test | Coach | Two clients, two templates, notes, conversations |
| alex@demo.test | Client | Push/Pull/Legs, uses kg, 3 weeks of logs |
| sam@demo.test | Client | Upper/Lower, uses lb |
| coach2@demo.test | Coach | No clients — use to check a coach outside a relationship is denied |

## How it fits together

```
src/
  proxy.ts                      session refresh + redirect signed-out users (Next 16 "proxy" = middleware)
  app/(auth)/login, signup      email + password auth; sign-up picks Coach or Client
  app/invite/[token]            invite preview + accept
  app/onboarding                client name, goal, kg/lb
  app/(client)/today|training|nutrition|progress|chat     client app (bottom nav)
  app/(client)/training/session/[id]                      workout logger
  app/coach/...                 dashboard, clients, client profile, plans + builder, messages, invite
  components/                   shared UI, chat thread, nutrition day, progress charts
supabase/
  migrations/                   schema, RLS policies + RPC functions, exercise library
  seed.sql                      demo coach, clients, plans, logs, messages
tests/acceptance.spec.ts        end-to-end acceptance tests (two browser sessions)
scripts/rls-check.mjs           direct API requests proving cross-account access is denied
```

### Key design decisions

- **Access control lives in Postgres.** Every table has RLS. The browser talks to Supabase with the user's own token, so the same rules apply to the UI and to hand-crafted requests. Clients reach only their own rows; coaches reach clients they are (or were) connected to, and write only while the relationship is active. Coach notes are visible only to the coach who wrote them. Privileged steps (accepting an invite, archiving, copying a plan, starting a session) are Postgres functions that re-check the caller.
- **Relationships.** `coach_clients` allows many clients per coach and, via a partial unique index, one active coach per client. Archiving keeps all history; restoring re-uses the same conversation.
- **Invites** are random 48-hex-char tokens, single use, with an expiry the coach picks; coaches can revoke pending links.
- **Plans.** Templates are plans without a client. Assigning copies the template (`copy_plan`) so it can be customised per client. Each workout day lists ISO weekdays; the Today screen shows the day whose weekday matches, once the start date has passed.
- **Completed sessions keep their original targets.** Starting a workout snapshots each exercise's name, sets, rep range, rest and notes into `session_exercises`. Later plan edits never touch existing sessions.
- **Resumable logging.** Each set is saved as it's entered (on blur / on ✓), so closing the app mid-workout loses nothing; Today shows "Resume workout". Completed sessions stay editable for corrections.
- **Units.** Weights are stored in kg and converted to the client's chosen unit for inputs, logs and charts (coaches see the client's unit too).
- **Messaging.** One conversation per relationship, created by trigger. New messages stream over Supabase Realtime (RLS applies to subscribers). The sender's device generates each message id, and sends use `upsert … ignoreDuplicates`, so retrying a failed send can never create a duplicate. Unread counts come from per-user read markers.

## Tests

With Supabase running and the dev server up (`npm run dev`):

```bash
npx playwright install chromium   # once
npm run test:acceptance           # the 7 acceptance flows, separate coach and client browser sessions
npm run test:rls                  # direct API access-denial checks
```

`test:acceptance` resets nothing but creates a fresh client per run; run `npx supabase db reset` for a clean slate.

## Out of scope

Billing, wearables, AI recommendations and barcode scanning are intentionally not included.
