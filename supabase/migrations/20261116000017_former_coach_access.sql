-- Former coaches and the coach–client relationship.
--
-- 1) A former coach keeps read access to the client's history, but only up to the day the
--    relationship ended. Before this, is_coach_of(client) without the active flag let them
--    read everything the client logged afterwards too (workouts, meals, weights,
--    measurements, progress photos and the photo files).
-- 2) coach_update_client needs an active relationship.
-- 3) Restoring an archived client is only an "undo" for the coach who archived, within a
--    few minutes. After that the coach sends a new invite, so the client agrees to reconnect.
--    Clients can now leave their coach themselves.

alter table public.coach_clients add column archived_by uuid references public.profiles (id) on delete set null;

-- ───────────────────────── 1) History cutoff ─────────────────────────
-- Can the calling coach see the client's data dated p_on?
-- Active relationship: everything. Archived: rows dated up to the day it ended.
create function public.coach_can_see(p_client uuid, p_on date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_clients cc
    where cc.coach_id = auth.uid() and cc.client_id = p_client
      and (cc.status = 'active' or p_on <= coalesce(cc.archived_at::date, 'infinity'::date))
  );
$$;

create or replace function public.session_access(p_session uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workout_sessions s
    where s.id = p_session
      and (s.client_id = auth.uid() or (not p_write and public.coach_can_see(s.client_id, s.scheduled_date)))
  );
$$;

drop policy "read sessions" on public.workout_sessions;
create policy "read sessions" on public.workout_sessions for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, scheduled_date));

drop policy "read meals" on public.meal_entries;
create policy "read meals" on public.meal_entries for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, entry_date));

drop policy "read body weight" on public.body_weights;
create policy "read body weight" on public.body_weights for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, entry_date));

drop policy "read body measurements" on public.body_measurements;
create policy "read body measurements" on public.body_measurements for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, entry_date));

drop policy "read progress photos" on public.progress_photos;
create policy "read progress photos" on public.progress_photos for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, taken_on));

-- Targets are current settings, possibly set by a later coach: dated by their last change.
drop policy "read targets" on public.nutrition_targets;
create policy "read targets" on public.nutrition_targets for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, updated_at::date));

drop policy "read muscle targets" on public.muscle_targets;
create policy "read muscle targets" on public.muscle_targets for select to authenticated
  using (client_id = auth.uid() or public.coach_can_see(client_id, updated_at::date));

-- Photo files: a coach may read a file only if they may read its progress_photos row.
create function public.coach_can_see_photo_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.progress_photos p
    where p.storage_path = p_name and public.coach_can_see(p.client_id, p.taken_on)
  );
$$;

drop policy "progress photos: client and coach read" on storage.objects;
create policy "progress photos: client and coach read" on storage.objects for select to authenticated
  using (
    bucket_id = 'progress-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.coach_can_see_photo_file(name))
  );
drop function public.is_coach_of_folder(text);

revoke execute on function public.coach_can_see(uuid, date) from public, anon;
grant execute on function public.coach_can_see(uuid, date) to authenticated;
revoke execute on function public.coach_can_see_photo_file(text) from public, anon;
grant execute on function public.coach_can_see_photo_file(text) to authenticated;

-- ───────────────────────── 2) Coaching details need an active relationship ─────────────────────────
create or replace function public.coach_update_client(
  p_client uuid, p_goal_type text, p_experience_level text, p_injuries text, p_training_days smallint
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach_of(p_client, true) then
    raise exception 'Not your client';
  end if;
  update public.profiles set
    goal_type = p_goal_type,
    experience_level = p_experience_level,
    injuries = nullif(trim(p_injuries), ''),
    training_days_per_week = p_training_days
  where id = p_client;
end $$;

-- ───────────────────────── 3) Archive, undo, leave ─────────────────────────
-- Coach archives a client, or undoes their own archive within 10 minutes.
create or replace function public.set_client_status(p_client uuid, p_status public.relationship_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rel public.coach_clients;
begin
  select * into v_rel from public.coach_clients
    where coach_id = auth.uid() and client_id = p_client
    order by created_at desc limit 1
    for update;
  if not found then raise exception 'Client not found'; end if;
  if v_rel.status = p_status then return; end if;

  if p_status = 'archived' then
    update public.coach_clients set status = 'archived', archived_at = now(), archived_by = auth.uid()
      where id = v_rel.id;
    return;
  end if;

  if v_rel.archived_by is distinct from auth.uid() or v_rel.archived_at < now() - interval '10 minutes' then
    raise exception 'To work with this client again, send them a new invite.';
  end if;
  if exists (select 1 from public.coach_clients where client_id = p_client and status = 'active') then
    raise exception 'This client is now working with another coach.';
  end if;
  update public.coach_clients set status = 'active', archived_at = null, archived_by = null
    where id = v_rel.id;
end $$;

-- Client ends the relationship with their current coach. History is kept.
create function public.leave_coach()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.coach_clients set status = 'archived', archived_at = now(), archived_by = auth.uid()
    where client_id = auth.uid() and status = 'active';
  if not found then raise exception 'You don''t have a coach right now.'; end if;
end $$;
revoke execute on function public.leave_coach() from public, anon;
grant execute on function public.leave_coach() to authenticated;

-- Same as before; reactivation also clears archived_by, and the "already have a coach"
-- message now points the client at leaving.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_existing public.coach_clients;
  v_rel uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.my_role() <> 'client' then raise exception 'Only client accounts can accept invitations'; end if;

  select * into v_inv from public.invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found'; end if;
  if v_inv.revoked then raise exception 'This invitation was revoked'; end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = auth.uid() then
      select id into v_rel from public.coach_clients where coach_id = v_inv.coach_id and client_id = auth.uid() and status = 'active';
      if v_rel is not null then return v_rel; end if;
    end if;
    raise exception 'This invitation has already been used';
  end if;
  if v_inv.expires_at < now() then raise exception 'This invitation has expired'; end if;

  select * into v_existing from public.coach_clients where client_id = auth.uid() and status = 'active';
  if found then
    if v_existing.coach_id = v_inv.coach_id then
      v_rel := v_existing.id;
    else
      raise exception 'You already have an active coach. Leave them from your profile page first.';
    end if;
  else
    -- Reactivate an archived relationship with the same coach so history and chat carry over.
    update public.coach_clients set status = 'active', archived_at = null, archived_by = null
      where id = (select id from public.coach_clients
                  where coach_id = v_inv.coach_id and client_id = auth.uid()
                  order by created_at desc limit 1)
      returning id into v_rel;
    if v_rel is null then
      insert into public.coach_clients (coach_id, client_id) values (v_inv.coach_id, auth.uid())
        returning id into v_rel;
    end if;
  end if;

  update public.invitations set accepted_by = auth.uid(), accepted_at = now() where id = v_inv.id;
  return v_rel;
end $$;
