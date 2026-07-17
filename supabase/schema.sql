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
  checked boolean not null default false
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

alter table households enable row level security;
alter table household_members enable row level security;
alter table products enable row level security;
alter table stock_items enable row level security;
alter table recipes enable row level security;
alter table meal_history enable row level security;
alter table shopping_list enable row level security;

-- households : visible/modifiable par ses membres, création libre pour un user authentifié.
create policy "households_select_members" on households
  for select using (is_household_member(id));
create policy "households_insert_self" on households
  for insert with check (auth.uid() = created_by);
create policy "households_update_members" on households
  for update using (is_household_member(id));

-- household_members : un membre voit les autres membres de ses foyers.
create policy "household_members_select" on household_members
  for select using (is_household_member(household_id));
create policy "household_members_insert_self" on household_members
  for insert with check (auth.uid() = user_id);

-- products : catalogue partagé en lecture/écriture par tout utilisateur authentifié (pas de donnée sensible).
create policy "products_select_all" on products for select using (auth.uid() is not null);
create policy "products_insert_all" on products for insert with check (auth.uid() is not null);

-- recipes : catalogue partagé en lecture seule (seedé côté serveur).
create policy "recipes_select_all" on recipes for select using (auth.uid() is not null);

-- Tables scopées par foyer : CRUD réservé aux membres du foyer.
create policy "stock_items_all_members" on stock_items
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "meal_history_all_members" on meal_history
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "shopping_list_all_members" on shopping_list
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));
