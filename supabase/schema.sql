-- Reel Log schema. Run once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Row-level security is what keeps your lists private: the anon key in config.js is
-- public, so every table MUST have RLS enabled with an owner-only policy.

create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (length(name) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table if not exists public.list_items (
  list_id       uuid not null references public.lists on delete cascade,
  tmdb_id       int  not null,
  title         text not null,
  poster_path   text,
  release_date  date,
  added_at      timestamptz not null default now(),
  primary key (list_id, tmdb_id)
);

create index if not exists lists_user_id_idx on public.lists (user_id);

alter table public.lists      enable row level security;
alter table public.list_items enable row level security;

drop policy if exists "own lists" on public.lists;
create policy "own lists" on public.lists for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own items" on public.list_items;
create policy "own items" on public.list_items for all
  to authenticated
  using (exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.lists l
    where l.id = list_items.list_id and l.user_id = (select auth.uid())
  ));

-- For You recommender: one 👍 (1) or 👎 (-1) per film. Flipping a vote is an upsert on the
-- primary key, so a film can never hold two votes. Stores only the TMDB id, so new
-- recommender data releases never strand old votes.
create table if not exists public.votes (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  tmdb_id   int  not null,
  thumb     smallint not null check (thumb in (1, -1)),
  voted_at  timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

alter table public.votes enable row level security;

drop policy if exists "own votes" on public.votes;
create policy "own votes" on public.votes for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The server stamps every vote and re-vote, so History order and the 60-day Rewatch rule
-- don't depend on each device's clock. Fires on the upsert's update too (flip / re-stamp).
create or replace function public.stamp_vote() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.voted_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_vote on public.votes;
create trigger stamp_vote before insert or update on public.votes
  for each row execute function public.stamp_vote();
