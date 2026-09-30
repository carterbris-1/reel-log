# Reel Log — Spec
> A personal Letterboxd-style movie site: search films, view cast and release info, keep
> lists. Static site on GitHub Pages + TMDB for movie data + Supabase for sign-in and
> storage. Biggest constraint: there is no server of our own — every secret the browser
> sees is public.

## 1. What it is

A single-user site for looking up movies and keeping lists of them, usable from both a
phone and a computer with the same data. Letterboxd does this but isn't yours to shape;
a plain bookmark file doesn't sync or show posters. GitHub Pages only serves static files,
so movie data comes straight from TMDB in the browser, and anything that must sync
(lists) lives in Supabase, protected by Postgres row-level security instead of a backend.

## 2. Requirements

**Search**
- R1. A search box, always visible in the header, queries TMDB by title.
- R2. Results show as a poster grid (poster, title, year). Missing posters get a
  text placeholder, not a broken image.
- R3. "Load more" fetches the next results page. A fast typist never sees results for an
  older query replace a newer one.
- R4. The home page (no query) shows TMDB weekly trending films.

**Movie detail**
- R5. Clicking a poster opens a detail page: backdrop, poster, title, year, tagline,
  overview, runtime, genres, director(s), US certification. No ratings anywhere.
- R6. Release info: primary release date plus the US release dates by type
  (Premiere, Theatrical limited, Theatrical, Digital, Physical, TV) when TMDB has them.
- R7. Cast: top 20 billed actors with photo, name, and character.
- R8. Clicking an actor opens a person page with their photo, bio, and film list
  (newest first), each linking back to a movie detail page.

**Lists**
- R9. Signed in: create, rename, and delete lists.
- R10. From a movie page, an "Add to list" panel shows every list with a checkbox;
  toggling adds or removes the film. A "new list" field creates a list and adds the
  film in one step.
- R11. A list page shows its films as a poster grid in the order added, each removable.
- R12a. Every list with 2+ films has a **Randomize** button, on the list page and on
  its My Lists card. It spins a wheel that lands on a uniformly random film from the
  whole list (max 20 segments shown, always including the winner), then links to it.
- R12. The My Lists page shows each list with its name, film count, and a stacked
  preview of its first 4 posters.

**Account and sync**
- R13. Sign in with email + password. Stays signed in on each device until sign-out.
- R14. A change made on one device appears on the other after a page reload (live push
  is a "later" item, see §6).
- R15. Signed out, search and movie pages work fully; list actions prompt sign-in.
- R16. Nobody but the owner can read or write list data, even with the public anon key.

**iPhone and computer — equal support, no platform preference**
- R20. Every feature works the same with a mouse on a computer and with touch on an
  iPhone, in both Safari and the Home Screen app. The iOS differences are handled here:
- R21. Home Screen app: an icon, name, and full-screen launch. It has no browser Back
  button, so the header shows its own ‹ Back (goes home if there's no in-app history).
- R22. Safari deletes site data after ~7 days unvisited, which signs you out. In iPhone
  Safari, a dismissible tip suggests Add to Home Screen, which is exempt.
- R23. Hover effects only apply on devices with a mouse, because a tap on iPhone would
  leave them stuck. Touch gets `:active` press feedback instead.
- R24. No iOS layout traps: inputs ≥16px so the page doesn't zoom, `dvh` instead of `vh`,
  notch safe areas, no `background-attachment: fixed`, no page scrolling behind dialogs.

**General**
- R17. Usable at 375px wide: search works one-handed, grids are 3 columns on phones.
- R18. Deep links (e.g. `/#/movie/27205`) work on refresh and when shared.
- R18a. Theme: movie-palace poster wall — plum walls, red ceiling with downlights,
  posters in black frames with brass trim, marquee type, red-carpet footer.
- R19. TMDB attribution (logo + notice) in the footer, as TMDB's terms require.

## 3. Stack and infrastructure

| Piece | Choice | Why / what it costs |
|---|---|---|
| Frontend | Vanilla JS (ES2022 modules), HTML, CSS. No framework, no build step | GitHub Pages serves the repo as-is; nothing to install or compile. Costs: hand-written DOM rendering. React + Vite would help past ~15 views; this app has 6 |
| Routing | Hash routes (`#/movie/:id`) | GitHub Pages has no rewrite rules; path routes 404 on refresh |
| Movie data | TMDB API v3, called from the browser | Free, has posters, cast, and per-country release dates. The key is visible to anyone (see §5) |
| Auth + DB | Supabase free tier: Auth (email/password) + Postgres with RLS | `@supabase/supabase-js@2` loaded as an ESM module from jsDelivr |
| Hosting | GitHub Pages from `main` branch, repo root | Free; HTTPS on `<user>.github.io/<repo>/` |
| Keep-alive | GitHub Actions cron workflow | Free-tier Supabase pauses after 7 days idle (see §5) |

**Binding limits.** Supabase free tier: 500 MB database, 50k monthly active users (irrelevant
here), project **pauses after 1 week of inactivity**. TMDB: ~40–50 requests/second per IP,
far above one person's use. GitHub Pages: 1 GB site, 100 GB/month bandwidth. Cost: $0.

**Files**
```
index.html        shell: header, <main id="app">, sign-in dialog
styles.css        dark theme, responsive grids
config.js         TMDB key, Supabase URL + anon key (all public by design)
js/app.js         router + view mounting
js/tmdb.js        fetch wrapper, image URL helper
js/db.js          Supabase client + list/item queries
js/views/*.js     home, search, movie, person, lists, list
js/wheel.js       random-pick wheel (SVG, CSS rotation)
js/ios.js         iPhone detection, Home Screen tip
manifest.webmanifest, icons/   Home Screen app name + icons
supabase/schema.sql   tables + RLS policies (run once in SQL editor)
.github/workflows/keepalive.yml
```

## 4. Data model

Postgres in Supabase. Movie facts are **not** stored; only a small snapshot of each film
so list pages render without one TMDB call per poster.

```sql
create table lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (length(name) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table list_items (
  list_id       uuid not null references lists on delete cascade,
  tmdb_id       int  not null,
  title         text not null,
  poster_path   text,            -- e.g. "/qJ2tW6WMUDux911r6m7haRef0WH.jpg"
  release_date  date,            -- nullable: unreleased films
  added_at      timestamptz not null default now(),
  primary key (list_id, tmdb_id) -- a film appears at most once per list
);

alter table lists      enable row level security;
alter table list_items enable row level security;

create policy "own lists" on lists for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own items" on list_items for all
  using      (exists (select 1 from lists l where l.id = list_items.list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from lists l where l.id = list_items.list_id and l.user_id = auth.uid()));
```

Shaping constraints:
- `user_id default auth.uid()` so the client never sends it and can't lie about it.
- Composite PK makes "add twice" a conflict; the client uses `upsert` so re-adding is a no-op.
- Order in a list = `added_at`. No manual reordering in v1, so no `position` column.
- My Lists page reads everything in one query:
  `lists.select('id,name,created_at,list_items(tmdb_id,poster_path,added_at)')`.

Client-side TMDB shapes used (not stored):
`/search/movie`, `/trending/movie/week`,
`/movie/{id}?append_to_response=credits,release_dates`,
`/person/{id}?append_to_response=movie_credits`.

## 5. Hard parts

**1. Public keys on a static site.** Both the TMDB key and Supabase anon key ship to
the browser. TMDB's key is read-only; worst case someone burns its rate limit, and
TMDB can rotate it. The Supabase anon key is *meant* to be public. Safety comes entirely
from RLS (§4). Handling: RLS is enabled in the same SQL file that creates the tables, and
task 5 checks it by querying with the anon key while signed out and signed in as a
second throwaway user. It must return zero rows. After creating your own account, **turn
off new sign-ups** in Supabase Auth settings, since this is a single-user site.
The service-role key never goes in the repo.

**2. Supabase free-tier pausing.** One person might not open the site for a week. The
project then pauses and the site shows network errors until it's manually restored in
the dashboard. Handling: a GitHub Actions workflow on `cron: '0 12 */3 * *'` runs a
`curl` against the REST endpoint (`/rest/v1/lists?select=id&limit=1` with the anon key),
which counts as activity. The app also catches Supabase fetch failures and shows "Lists
are temporarily unavailable". It does not show a blank page.

**3. Out-of-order responses and stale renders.** Typing "the", "the g", "the godfather"
fires three searches. If "the" returns last, it overwrites the right results. The same
happens when navigating movie → movie quickly. Handling: every route render gets an
incrementing token. A response only touches the DOM if its token is still current.
Search is submitted on Enter or after a 350 ms debounce, never on every keystroke.

**4. Auth sessions across devices.** supabase-js stores the session in `localStorage`
and refreshes the token itself. Email + password avoids redirect flows: magic links and
Google OAuth both need the exact `github.io/<repo>/` URL registered as a redirect, and
opening a magic link on the phone from a desktop mail client lands on the wrong device.
Supabase Auth → URL Configuration still gets the Pages URL as Site URL, for password
resets. iOS "Add to Home Screen" apps get their own storage, so you sign in once more
there. Expected, and noted in the README.

## 6. Scope

**v1:** R1–R19.

**Later:**
- Live sync without reload (Supabase Realtime on `list_items`).
- Manual reordering of films within a list (`position` column, fractional indexing).
- Public read-only share link for a list (needs a `public` flag + an RLS read policy).
- Filter/sort search results by year or genre.
- PWA manifest + service worker for offline poster caching.

**Out of scope:** ratings of any kind (yours or TMDB's), multiple users, social features, custom domain, a backend of our own,
storing full TMDB records.

## 7. Tasks

### Phase A — A movie site that runs (no accounts yet)
1. **Repo skeleton + Pages deploy.** `index.html`, `styles.css`, `config.js`, `js/app.js`
   with hash router and placeholder views; push; enable Pages.
   *Done when:* `https://<user>.github.io/<repo>/#/lists` loads on phone and desktop and
   refresh keeps the route.
2. **TMDB wrapper + trending home.** `js/tmdb.js` (key or v4 bearer token, error
   handling, image URL helper); home renders trending poster grid. Depends on 1.
   *Done when:* the home page shows 20 trending posters; a bad key shows a readable
   setup message instead of a blank page.
3. **Search with stale-response guard.** Header search, results grid, Load more,
   debounce, render tokens. Depends on 2.
   *Done when:* searching "alien" shows posters. Typing quickly never leaves results
   from an earlier query, and page 2 appends without duplicates.
4. **Movie detail page.** Backdrop, facts, US certification, release-date table, cast
   grid; person page with filmography. Depends on 2.
   *Done when:* `#/movie/27205` (Inception) shows Christopher Nolan, Leonardo DiCaprio,
   and US theatrical date 2010-07-16. Clicking DiCaprio lists his films, and clicking
   one returns to a detail page.

### Phase B — Accounts and storage
5. **Supabase project + schema + RLS.** Create project, run `supabase/schema.sql`,
   create your account, disable sign-ups, set Site URL. Depends on nothing.
   *Done when:* with the anon key, `select * from lists` as a signed-out client returns
   0 rows. A second test user can't see your rows. The test user is then deleted.
6. **Sign-in dialog + session UI.** `js/db.js` client init; email/password dialog;
   header shows avatar initial + Sign out. Depends on 1, 5.
   *Done when:* signing in on the phone and desktop both survive a page reload, and
   sign-out on one doesn't affect the other.
7. **Keep-alive workflow.** `.github/workflows/keepalive.yml` with the anon key and URL
   as repo secrets. Depends on 5.
   *Done when:* a manual `workflow_dispatch` run succeeds with HTTP 200.

### Phase C — Lists end to end
8. **Create + view lists.** My Lists page with the create form and list cards (count +
   poster stack); one-query fetch. Depends on 6.
   *Done when:* a list created on desktop appears on the phone after reload.
9. **Add to list from movie page.** Checkbox panel, upsert/delete of `list_items`,
   inline new-list-and-add. Depends on 4, 8.
   *Done when:* toggling a checkbox twice leaves the list unchanged, and adding the
   same film from two tabs doesn't error or create a duplicate.
10. **List page.** Poster grid ordered by `added_at`, remove button, rename, delete
    (with confirm). Depends on 8.
    *Done when:* deleting a list removes its items (cascade), and navigating to its old
    URL shows "List not found".
11. **Signed-out and failure states.** List actions open sign-in; Supabase outage shows
    "Lists are temporarily unavailable"; TMDB errors show retry. Depends on 9, 10.
    *Done when:* with the network throttled to offline in DevTools, every view shows a
    message, never a blank page or uncaught error.

### Phase D — Finish
12. **Mobile polish + attribution.** 375px layout pass, TMDB footer attribution,
    `theme-color`, safe-area insets. Depends on 11.
    *Done when:* every page is usable on an iPhone-width viewport without horizontal
    scroll, and the footer shows the TMDB notice.
13. **README.** Setup steps for TMDB key, Supabase project, schema, disabling sign-ups,
    Pages, keep-alive secrets. Depends on 12.
    *Done when:* following it from a fresh clone reproduces a working site.

## 8. Risks and gotchas

1. **Forgetting to disable sign-ups** lets strangers create accounts. RLS still keeps
   them out of your data, but they consume your free-tier quota.
2. **RLS off = data public.** A table created in the dashboard UI instead of the SQL
   file may have RLS disabled. Supabase's security advisor flags it; check it after task 5.
3. **Supabase paused anyway** if the Actions cron is disabled. GitHub disables scheduled
   workflows after 60 days of no repo commits. You'll get an email; re-enable it.
4. **TMDB key abuse.** If it's scraped and rate-limited, regenerate it in TMDB settings
   and update `config.js`. That's a single-file change.
5. **Pages cache.** GitHub Pages serves with ~10 min caching; after a deploy the phone
   may show the old version. Append `?v=N` to `app.js`/`styles.css` on changes.
6. **Snapshot drift.** A list keeps the title/poster from when the film was added. If TMDB
   later changes a poster, the list shows the old one. Acceptable; the detail page is live.
7. **Missing release data.** Many non-US films lack US release dates. R6 falls back to
   the primary date alone rather than an empty table.
8. **Repo name in URLs.** All asset paths must be relative (`styles.css`, not
   `/styles.css`). Pages serves from `/<repo>/`, and absolute paths break.
9. **iOS can't be tested on a desktop.** Check each release on a real iPhone, in both Safari and
   the Home Screen app. Chrome's device emulation doesn't reproduce Safari's quirks.

## 9. Assumptions and open decisions

| # | Question | Default assumed |
|---|---|---|
| 1 | Who uses it? | Just you — **answered** |
| 2 | Features in v1? | Lists only — **answered** |
| 3 | Backend? | Supabase — **answered** |
| 3b | Ratings? | None anywhere — **answered** |
| 3c | Platform priority? | None: iPhone and computer equally — **answered** |
| 4 | Sign-in method | Email + password (no redirect setup; works same on phone and desktop) |
| 5 | Framework / build step | None — vanilla JS modules served as-is |
| 6 | Routing | Hash routes, so refresh and deep links work on Pages |
| 7 | Country for release dates + certification | United States |
| 8 | Cross-device sync | On page load; live Realtime push is "later" |
| 9 | Order of films in a list | Date added, oldest first; no manual reordering |
| 10 | Can one film be in several lists? | Yes; once per list |
| 11 | Home page content | TMDB weekly trending |
| 12 | Cast shown on detail page | Top 20 billed |
| 13 | Adult content in search | Excluded (`include_adult=false`) |
| 14 | Site name | "Reel Log" (placeholder) |
| 15 | Theme | Dark, Letterboxd-like palette |
| 16 | Repo / URL | `<user>.github.io/<repo>/`, no custom domain |
| 17 | Keep Supabase awake | GitHub Actions ping every 3 days |
