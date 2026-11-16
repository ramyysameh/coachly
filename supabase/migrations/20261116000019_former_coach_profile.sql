-- A former coach could still read the client's whole profile row: goal, injuries, date of
-- birth, height, experience and training days, including changes made after they parted.
-- Now only an active coach reads the profile. A former coach gets just what their history
-- screens need (name, photo and weight unit) through client_names().

drop policy "read own, my clients, my coaches" on public.profiles;
create policy "read own, my clients, my coaches" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_coach_of(id, true) or public.is_client_of(id));

-- Name, photo and weight unit of the calling coach's clients, current or past.
-- Ids that were never the caller's clients are silently left out.
create function public.client_names(p_ids uuid[])
returns table (id uuid, full_name text, avatar_url text, weight_unit public.weight_unit)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url, p.weight_unit
  from public.profiles p
  where p.id = any (p_ids)
    and exists (select 1 from public.coach_clients cc where cc.coach_id = auth.uid() and cc.client_id = p.id);
$$;
revoke execute on function public.client_names(uuid[]) from public, anon;
grant execute on function public.client_names(uuid[]) to authenticated;
