-- Plan policies looked the row up by id through plan_access(), which can't see a row
-- that is still being inserted, so INSERT … RETURNING (creating a template) failed.
-- Check the row's own columns instead.

drop policy "read plans" on public.plans;
drop policy "coach updates plans" on public.plans;
drop policy "coach deletes plans" on public.plans;

create policy "read plans" on public.plans for select to authenticated
  using (
    (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id)))
    or client_id = auth.uid()
  );

create policy "coach updates plans" on public.plans for update to authenticated
  using (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)))
  with check (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)));

create policy "coach deletes plans" on public.plans for delete to authenticated
  using (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)));
