-- Nutrition plans: reusable meal-plan templates a coach builds once (daily calories + macros and a
-- per-meal breakdown) and assigns to clients. Like training plans, client_id is null for a template;
-- assigning copies the template for that client and sets their nutrition_targets to match.
-- A client has at most one nutrition plan; assigning a new one replaces it.

create table public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  notes text,
  calories int not null default 0 check (calories between 0 and 20000),
  protein_g int not null default 0 check (protein_g between 0 and 2000),
  carbs_g int not null default 0 check (carbs_g between 0 and 2000),
  fat_g int not null default 0 check (fat_g between 0 and 2000),
  source_plan_id uuid references public.nutrition_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nutrition_plans_coach on public.nutrition_plans (coach_id);
create unique index nutrition_plans_one_per_client on public.nutrition_plans (client_id) where client_id is not null;
create trigger nutrition_plans_touch before update on public.nutrition_plans
  for each row execute function public.touch_updated_at();

create table public.nutrition_plan_meals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  position smallint not null default 0,
  meal public.meal_type not null,
  name text not null check (length(trim(name)) > 0),
  details text,
  calories int not null default 0 check (calories between 0 and 10000),
  protein_g int not null default 0 check (protein_g between 0 and 1000),
  carbs_g int not null default 0 check (carbs_g between 0 and 1000),
  fat_g int not null default 0 check (fat_g between 0 and 1000)
);
create index nutrition_plan_meals_plan on public.nutrition_plan_meals (plan_id, position);

-- ───── access ─────
alter table public.nutrition_plans enable row level security;
alter table public.nutrition_plan_meals enable row level security;

create function public.nutrition_plan_access(p_plan uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.nutrition_plans p
    where p.id = p_plan
      and (
        (p.coach_id = auth.uid() and (p.client_id is null or public.is_coach_of(p.client_id, p_write)))
        or (not p_write and p.client_id = auth.uid())
      )
  );
$$;
grant execute on function public.nutrition_plan_access(uuid, boolean) to authenticated;

-- Row's own columns (not nutrition_plan_access) so INSERT … RETURNING works; see 20261111000004.
create policy "read nutrition plans" on public.nutrition_plans for select to authenticated
  using (
    (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id)))
    or client_id = auth.uid()
  );
create policy "coach creates nutrition plans" on public.nutrition_plans for insert to authenticated
  with check (coach_id = auth.uid() and public.my_role() = 'coach'
              and (client_id is null or public.is_coach_of(client_id, true)));
create policy "coach updates nutrition plans" on public.nutrition_plans for update to authenticated
  using (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)))
  with check (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)));
create policy "coach deletes nutrition plans" on public.nutrition_plans for delete to authenticated
  using (coach_id = auth.uid() and (client_id is null or public.is_coach_of(client_id, true)));

create policy "read nutrition plan meals" on public.nutrition_plan_meals for select to authenticated
  using (public.nutrition_plan_access(plan_id, false));
create policy "write nutrition plan meals" on public.nutrition_plan_meals for all to authenticated
  using (public.nutrition_plan_access(plan_id, true)) with check (public.nutrition_plan_access(plan_id, true));

-- Copies a template for a client, replacing their current nutrition plan,
-- and sets their daily targets to the plan's. Runs as the caller, so the policies above apply.
create function public.assign_nutrition_plan(p_source uuid, p_client uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.nutrition_plans;
  v_new uuid;
begin
  select * into v_src from public.nutrition_plans where id = p_source and coach_id = auth.uid() and client_id is null;
  if not found then raise exception 'Nutrition template not found'; end if;
  if not public.is_coach_of(p_client, true) then raise exception 'Not your client'; end if;

  delete from public.nutrition_plans where client_id = p_client;
  insert into public.nutrition_plans (coach_id, client_id, name, notes, calories, protein_g, carbs_g, fat_g, source_plan_id)
  values (auth.uid(), p_client, v_src.name, v_src.notes, v_src.calories, v_src.protein_g, v_src.carbs_g, v_src.fat_g,
          v_src.id)
  returning id into v_new;

  insert into public.nutrition_plan_meals (plan_id, position, meal, name, details, calories, protein_g, carbs_g, fat_g)
  select v_new, position, meal, name, details, calories, protein_g, carbs_g, fat_g
  from public.nutrition_plan_meals where plan_id = p_source;

  insert into public.nutrition_targets (client_id, calories, protein_g, carbs_g, fat_g, updated_by, updated_at)
  values (p_client, v_src.calories, v_src.protein_g, v_src.carbs_g, v_src.fat_g, auth.uid(), now())
  on conflict (client_id) do update set
    calories = excluded.calories, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return v_new;
end $$;
grant execute on function public.assign_nutrition_plan(uuid, uuid) to authenticated;
