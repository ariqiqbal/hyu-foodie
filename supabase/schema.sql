-- HYU Foodie - Supabase database setup
-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.

-- 1) Votes: one vote per user per place (+1 = Worth it, -1 = Not worth it)
create table if not exists public.votes (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  place_id   text not null,
  value      smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.votes enable row level security;

drop policy if exists "read own votes"   on public.votes;
drop policy if exists "insert own vote"  on public.votes;
drop policy if exists "update own vote"  on public.votes;
drop policy if exists "delete own vote"  on public.votes;
create policy "read own votes"  on public.votes for select using (auth.uid() = user_id);
create policy "insert own vote" on public.votes for insert with check (auth.uid() = user_id);
create policy "update own vote" on public.votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own vote" on public.votes for delete using (auth.uid() = user_id);

-- 2) Public vote totals (counts only, no user ids)
create or replace view public.vote_totals as
  select place_id,
         count(*) filter (where value = 1)  as yes,
         count(*) filter (where value = -1) as no
  from public.votes
  group by place_id;
grant select on public.vote_totals to anon, authenticated;

-- 3) Saved places: private to each user
create table if not exists public.saved (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  place_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.saved enable row level security;
drop policy if exists "own saved" on public.saved;
create policy "own saved" on public.saved for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
