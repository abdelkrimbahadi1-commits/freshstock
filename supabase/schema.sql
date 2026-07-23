-- FreshStock — schéma initial + RLS par foyer.
-- A exécuter dans le SQL editor du projet Supabase dédié à l'app.

create extension if not exists "pgcrypto";

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text not null default 'autre',
  default_shelf_life_days integer not null default 14,
  image_url text
);

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  product_id uuid references products (id),
  barcode text,
  name text not null,
  category text not null default 'autre',
  quantity numeric not null default 1,
  unit text not null default 'unite',
  location text not null default 'placard' check (location in ('frigo', 'congelateur', 'placard', 'autre')),
  purchase_date date not null default current_date,
  expiry_date date not null,
  price numeric,
  added_by uuid references auth.users (id),
  status text not null default 'in_stock' check (status in ('in_stock', 'consumed', 'discarded')),
  updated_at timestamptz not null default now()
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tags text[] not null default '{}',
  ingredients jsonb not null default '[]',
  instructions text not null default '',
  prep_time_minutes integer not null default 20,
  nutrition_tags text[] not null default '{}'
);

create table if not exists meal_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  recipe_id uuid references recipes (id),
  date date not null default current_date,
  ingredients_used jsonb not null default '[]'
);

create table if not exists shopping_list (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  item_name text not null,
  quantity numeric not null default 1,
  unit text not null default 'unite',
  source text not null default 'manual' check (source in ('manual', 'auto')),
  recipe_name text,
  checked boolean not null default false
);

-- Ajoutée après la création initiale de la table : `alter` idempotent pour
-- les projets Supabase où `shopping_list` existait déjà sans cette colonne.
alter table shopping_list add column if not exists recipe_name text;

-- Avis utilisateurs (écrits ou dictés à l'oral puis transcrits côté client).
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

-- Helper: l'utilisateur courant appartient-il à ce foyer ?
create or replace function is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from household_members
    where household_id = target_household_id
      and user_id = auth.uid()
  );
$$;

-- Helper : l'utilisateur courant est-il administrateur (owner) de ce foyer ?
-- Défini ici (avant les policies) car households_update_members en a besoin.
create or replace function is_household_owner(target_household_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from household_members
    where household_id = target_household_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

alter table households enable row level security;
alter table household_members enable row level security;
alter table products enable row level security;
alter table stock_items enable row level security;
alter table recipes enable row level security;
alter table meal_history enable row level security;
alter table shopping_list enable row level security;
alter table feedback enable row level security;

-- households : visible par ses membres, création libre pour un user authentifié,
-- modification réservée à l'administrateur (owner) du foyer.
drop policy if exists "households_select_members" on households;
create policy "households_select_members" on households
  for select using (is_household_member(id));
drop policy if exists "households_insert_self" on households;
create policy "households_insert_self" on households
  for insert with check (auth.uid() = created_by);
drop policy if exists "households_update_members" on households;
create policy "households_update_members" on households
  for update using (is_household_owner(id));

-- household_members : un membre voit les autres membres de ses foyers.
-- Aucune policy INSERT/UPDATE/DELETE côté client : l'ajout d'un membre ne
-- doit se produire que via les fonctions security definer ci-dessous
-- (create_household, redeem_join_approval), qui contrôlent explicitement
-- qui peut rejoindre un foyer et comment. Sans policy d'écriture, RLS
-- refuse par défaut toute tentative d'insertion directe (ex. un appel
-- REST/JS forgé qui contournerait le flux demande → approbation → code).
drop policy if exists "household_members_select" on household_members;
create policy "household_members_select" on household_members
  for select using (is_household_member(household_id));
drop policy if exists "household_members_insert_self" on household_members;

-- products : catalogue partagé en lecture/écriture par tout utilisateur authentifié (pas de donnée sensible).
drop policy if exists "products_select_all" on products;
create policy "products_select_all" on products for select using (auth.uid() is not null);
drop policy if exists "products_insert_all" on products;
create policy "products_insert_all" on products for insert with check (auth.uid() is not null);

-- recipes : catalogue partagé en lecture seule (seedé côté serveur).
drop policy if exists "recipes_select_all" on recipes;
create policy "recipes_select_all" on recipes for select using (auth.uid() is not null);

-- Tables scopées par foyer : CRUD réservé aux membres du foyer.
drop policy if exists "stock_items_all_members" on stock_items;
create policy "stock_items_all_members" on stock_items
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

drop policy if exists "meal_history_all_members" on meal_history;
create policy "meal_history_all_members" on meal_history
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

drop policy if exists "shopping_list_all_members" on shopping_list;
create policy "shopping_list_all_members" on shopping_list
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

drop policy if exists "feedback_all_members" on feedback;
create policy "feedback_all_members" on feedback
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- Créer/rejoindre un foyer nécessite de contourner RLS à l'intérieur de la
-- transaction : au moment de créer le foyer (ou de le retrouver par code),
-- l'utilisateur n'est pas encore membre, donc la policy SELECT sur
-- `households` bloquerait la ligne renvoyée par un simple insert/select côté
-- client. Ces deux fonctions security definer font l'insert du foyer +
-- l'ajout du membre de façon atomique, sans exposer d'accès plus large.
create or replace function create_household(p_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household households;
  v_join_code text := upper(substr(md5(random()::text), 1, 6));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into households (name, join_code, created_by)
  values (p_name, v_join_code, auth.uid())
  returning * into v_household;

  insert into household_members (household_id, user_id, role)
  values (v_household.id, auth.uid(), 'owner');

  return v_household;
end;
$$;

grant execute on function create_household(text) to authenticated;

-- L'ancien flux de jonction directe par code (join_household_by_code) est
-- supprimé : il permettait de rejoindre un foyer instantanément avec le
-- seul code d'invitation, en contournant complètement le workflow
-- demande → approbation par l'administrateur → code → finalisation
-- ci-dessous. Le frontend ne l'appelait déjà plus ; ce `drop` ferme
-- l'accès pour de bon, y compris pour un appel RPC direct forgé.
drop function if exists join_household_by_code(text);

-- Rejoindre un foyer avec validation par un administrateur : le demandeur
-- envoie une demande (identifiée par le code du foyer), un administrateur
-- (role 'owner') l'approuve depuis l'app et reçoit un code d'approbation à
-- transmettre hors-app au demandeur, qui l'utilise pour finaliser son entrée.
create table if not exists household_join_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'redeemed')),
  approval_code text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table household_join_requests enable row level security;

-- (is_household_owner est défini plus haut, avant les policies households,
-- qui en ont besoin dès leur création.)

-- Le demandeur voit ses propres demandes ; l'administrateur voit celles de son foyer.
drop policy if exists "join_requests_select_own_or_owner" on household_join_requests;
create policy "join_requests_select_own_or_owner" on household_join_requests
  for select using (requester_id = auth.uid() or is_household_owner(household_id));

-- Toutes les écritures passent par les fonctions security definer ci-dessous :
-- aucune policy INSERT/UPDATE n'est nécessaire côté client.

create or replace function request_to_join_household(p_code text)
returns household_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household households;
  v_request household_join_requests;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_household from households where join_code = upper(p_code);
  if v_household.id is null then
    raise exception 'invalid_code';
  end if;

  if exists (
    select 1 from household_members
    where household_id = v_household.id and user_id = auth.uid()
  ) then
    raise exception 'already_member';
  end if;

  select * into v_request from household_join_requests
  where household_id = v_household.id and requester_id = auth.uid() and status = 'pending';

  if v_request.id is null then
    insert into household_join_requests (household_id, requester_id)
    values (v_household.id, auth.uid())
    returning * into v_request;
  end if;

  return v_request;
end;
$$;

grant execute on function request_to_join_household(text) to authenticated;

create or replace function list_pending_join_requests()
returns table (id uuid, household_id uuid, requester_id uuid, requester_email text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.household_id, r.requester_id, u.email, r.created_at
  from household_join_requests r
  join auth.users u on u.id = r.requester_id
  where r.status = 'pending' and is_household_owner(r.household_id)
  order by r.created_at asc;
$$;

grant execute on function list_pending_join_requests() to authenticated;

create or replace function approve_join_request(p_request_id uuid)
returns household_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request household_join_requests;
  v_code text := upper(substr(md5(random()::text), 1, 6));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request from household_join_requests where id = p_request_id;
  if v_request.id is null or not is_household_owner(v_request.household_id) then
    raise exception 'not_authorized';
  end if;

  update household_join_requests
  set status = 'approved', approval_code = v_code, decided_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function approve_join_request(uuid) to authenticated;

create or replace function reject_join_request(p_request_id uuid)
returns household_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request household_join_requests;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request from household_join_requests where id = p_request_id;
  if v_request.id is null or not is_household_owner(v_request.household_id) then
    raise exception 'not_authorized';
  end if;

  update household_join_requests
  set status = 'rejected', decided_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function reject_join_request(uuid) to authenticated;

create or replace function redeem_join_approval(p_code text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request household_join_requests;
  v_household households;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request from household_join_requests
  where approval_code = upper(p_code) and status = 'approved' and requester_id = auth.uid();

  if v_request.id is null then
    raise exception 'invalid_code';
  end if;

  insert into household_members (household_id, user_id, role)
  values (v_request.household_id, auth.uid(), 'member')
  on conflict do nothing;

  update household_join_requests set status = 'redeemed' where id = v_request.id;

  select * into v_household from households where id = v_request.household_id;
  return v_household;
end;
$$;

grant execute on function redeem_join_approval(text) to authenticated;
