-- =========================================================================
--  Bigpot Publication — database schema, security & storage
--  Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query).
--  Safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- =========================================================================

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ============================== TABLES ===================================

-- profiles: one row per auth user, holds the role flag (customer | admin)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  role        text not null default 'customer' check (role in ('customer','admin')),
  created_at  timestamptz not null default now()
);

-- books: the live catalogue (replaces the hardcoded data.js)
create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  category    text not null check (category in ('rpf','engineering')),
  title       text not null,
  subtitle    text,
  tagline     text,
  edition     text,
  description text,
  price       numeric,            -- optional; null = "enquire for price"
  in_stock    boolean not null default true,
  cover_path  text,               -- first image (relative repo path OR full storage URL)
  pages       jsonb not null default '[]'::jsonb,   -- array of image paths/URLs
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- orders: captured enquiries / orders (payment handled manually)
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,  -- null = guest
  name            text not null,
  contact         text not null,
  books_requested text,
  items           jsonb,          -- optional structured cart [{book_id,title,qty}]
  message         text,
  address         text,
  status          text not null default 'new'
                  check (status in ('new','contacted','fulfilled','cancelled')),
  created_at      timestamptz not null default now()
);

create index if not exists books_category_idx on public.books (category, sort_order);
create index if not exists orders_user_idx     on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx   on public.orders (status, created_at desc);

-- ============================ HELPERS ====================================

-- is_admin(): true when the current user has role = 'admin'.
-- SECURITY DEFINER + owned by postgres => bypasses RLS, so no policy recursion.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ====================== ROW-LEVEL SECURITY ===============================
alter table public.profiles enable row level security;
alter table public.books    enable row level security;
alter table public.orders   enable row level security;

-- profiles --------------------------------------------------------------
drop policy if exists "profiles read own or admin"  on public.profiles;
drop policy if exists "profiles insert own"         on public.profiles;
drop policy if exists "profiles update own or admin" on public.profiles;

create policy "profiles read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles insert own" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles update own or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
              with check (id = auth.uid() or public.is_admin());

-- books -----------------------------------------------------------------
drop policy if exists "books public read"  on public.books;
drop policy if exists "books admin insert" on public.books;
drop policy if exists "books admin update" on public.books;
drop policy if exists "books admin delete" on public.books;

create policy "books public read"  on public.books for select using (true);
create policy "books admin insert" on public.books for insert with check (public.is_admin());
create policy "books admin update" on public.books for update using (public.is_admin()) with check (public.is_admin());
create policy "books admin delete" on public.books for delete using (public.is_admin());

-- orders ----------------------------------------------------------------
drop policy if exists "orders anyone insert"     on public.orders;
drop policy if exists "orders read own or admin" on public.orders;
drop policy if exists "orders admin update"      on public.orders;
drop policy if exists "orders admin delete"      on public.orders;

create policy "orders anyone insert" on public.orders
  for insert with check (true);                 -- guests + customers may order
create policy "orders read own or admin" on public.orders
  for select using (auth.uid() = user_id or public.is_admin());
create policy "orders admin update" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());
create policy "orders admin delete" on public.orders
  for delete using (public.is_admin());

-- ============================== GRANTS ===================================
-- RLS is the real gate; these table privileges just let the API roles try.
grant usage on schema public to anon, authenticated;

grant select                         on public.books    to anon, authenticated;
grant insert, update, delete         on public.books    to authenticated; -- RLS → admin only
grant insert                         on public.orders   to anon, authenticated;
grant select, update, delete         on public.orders   to authenticated; -- RLS scopes rows
grant select, insert, update         on public.profiles to authenticated;

-- ============================= STORAGE ===================================
insert into storage.buckets (id, name, public)
values ('book-images', 'book-images', true)
on conflict (id) do nothing;

drop policy if exists "book-images public read"   on storage.objects;
drop policy if exists "book-images admin insert"  on storage.objects;
drop policy if exists "book-images admin update"  on storage.objects;
drop policy if exists "book-images admin delete"  on storage.objects;

create policy "book-images public read" on storage.objects
  for select using (bucket_id = 'book-images');
create policy "book-images admin insert" on storage.objects
  for insert with check (bucket_id = 'book-images' and public.is_admin());
create policy "book-images admin update" on storage.objects
  for update using (bucket_id = 'book-images' and public.is_admin());
create policy "book-images admin delete" on storage.objects
  for delete using (bucket_id = 'book-images' and public.is_admin());

-- =========================================================================
--  After running this, sign up once on the site, then run (with your email):
--    update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
-- =========================================================================
