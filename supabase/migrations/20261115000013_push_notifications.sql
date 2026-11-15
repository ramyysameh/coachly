-- Web push notifications: a new chat message, and a client finishing a workout (to their coach).
-- The app's /api/notify route asks push_targets() who to notify about something the caller just did;
-- the function checks the caller really did it, so no one can push to people they aren't connected to.

-- ───────────────────────── Subscriptions ─────────────────────────
-- One row per browser/device a user turned notifications on in.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
-- Users see and manage only their own devices.
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Each event is notified at most once, however often the route is called (retried sends, replays).
create table public.push_log (
  kind text not null check (kind in ('message', 'workout')),
  ref uuid not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.push_log enable row level security;  -- no policies: only the functions below touch it
revoke all on public.push_log from anon, authenticated;

-- ───────────────────────── Who to notify ─────────────────────────
-- Returns the devices to notify, with the text to show, for an event the caller caused:
--   'message' (ref = message id): the caller sent it in the last 10 minutes → the other person in the chat.
--   'workout' (ref = session id): the caller's own workout, finished in the last hour → their active coach.
-- Anything else, or a repeat for the same event, returns no rows.
create function public.push_targets(p_kind text, p_ref uuid)
returns table (endpoint text, p256dh text, auth_key text, title text, body text, url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid;
  v_title text;
  v_body text;
  v_url text;
begin
  if p_kind = 'message' then
    select case when m.sender_id = c.coach_id then c.client_id else c.coach_id end,
           p.full_name, left(m.body, 140),
           case when m.sender_id = c.coach_id then '/chat' else '/coach/messages?client=' || c.client_id end
      into v_to, v_title, v_body, v_url
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.coach_clients cc on cc.id = c.relationship_id and cc.status = 'active'
    join public.profiles p on p.id = m.sender_id
    where m.id = p_ref and m.sender_id = auth.uid() and m.created_at > now() - interval '10 minutes';
  elsif p_kind = 'workout' then
    select cc.coach_id, p.full_name || ' finished ' || s.name, 'Tap to see the sets they logged.',
           '/coach/clients/' || s.client_id || '?tab=workouts'
      into v_to, v_title, v_body, v_url
    from public.workout_sessions s
    join public.coach_clients cc on cc.client_id = s.client_id and cc.status = 'active'
    join public.profiles p on p.id = s.client_id
    where s.id = p_ref and s.client_id = auth.uid() and s.status = 'completed'
      and s.completed_at > now() - interval '1 hour';
  end if;
  if v_to is null then return; end if;

  insert into public.push_log (kind, ref) values (p_kind, p_ref) on conflict do nothing;
  if not found then return; end if;  -- already notified

  return query
    select ps.endpoint, ps.p256dh, ps.auth, coalesce(nullif(trim(v_title), ''), 'Coachly'), v_body, v_url
    from public.push_subscriptions ps where ps.user_id = v_to;
end $$;

-- Drops devices the push service reported as gone (unsubscribed or expired). Endpoints are
-- unguessable URLs, and the route only passes ones push_targets() just returned.
create function public.forget_push_endpoints(p_endpoints text[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
$$;

revoke execute on function public.push_targets(text, uuid) from public, anon;
grant execute on function public.push_targets(text, uuid) to authenticated;
revoke execute on function public.forget_push_endpoints(text[]) from public, anon;
grant execute on function public.forget_push_endpoints(text[]) to authenticated;
