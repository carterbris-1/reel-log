# Reel Log

A personal Letterboxd-style movie site with a movie-palace poster-wall theme. Search films,
see cast and release dates, keep lists that sync between your phone and computer, and
press **🎡 Randomize** on any list to spin a wheel that picks tonight's movie. Works the
same on your computer and your iPhone (including as a Home Screen app).

Written in **TypeScript** (`src/`), compiled to plain JavaScript (`js/`) with no bundler
or framework. Hosted free on GitHub Pages, movie data from TMDB, sign-in and lists stored
in Supabase.

- `CODE_GUIDE.md`: how every file works
- `TYPESCRIPT_MIGRATION.md`: what changed in the switch from JavaScript

**Live site:** <https://carterbris-1.github.io/reel-log/>

## Everyday workflow

```bash
npm install          # once, after cloning (installs TypeScript + Supabase types)
npm run watch        # recompiles src/*.ts → js/*.js every time you save
npm run serve        # in a second terminal: http://localhost:8000
```

Edit files in **`src/`** (never in `js/`, which gets overwritten). When you're happy:

```bash
git add -A && git commit -m "Describe the change" && git push
```

GitHub then type-checks, builds and publishes automatically (**Actions → Build and
deploy**, about a minute). If there's a type error the deploy stops and the live site
keeps the previous version.

| Command | What it does |
|---|---|
| `npm run build` | Compile once (`src/` → `js/`) |
| `npm run watch` | Compile on every save |
| `npm run typecheck` | Check types without writing any files |
| `npm run serve` | Local web server on port 8000 |

## Setup from scratch (about 15 minutes)

You only need this to rebuild the site somewhere new. The live site is already set up.

### 1. TMDB API key (movie data)
1. Create a free account at <https://www.themoviedb.org/signup>. User: carterb11220
2. Go to **Settings → API** and request a developer key (personal use).
3. Copy the **API Key** (or the longer **API Read Access Token**, either works) into
   `TMDB_API_KEY` in `src/config.ts`.

### 2. Supabase (sign-in + your lists)
1. Create a free project at <https://supabase.com/dashboard>.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**.
3. **Authentication → Users → Add user → Create new user**: enter your email and a
   password, and tick **Auto Confirm User**. This is the login you'll use on every device.
4. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
   The site is just for you, so nobody else should be able to create an account.
5. Copy the **Project URL** (**Project Settings → Data API**, or `https://<project-id>.supabase.co`
   where the ID is in the dashboard's address bar) and the **Publishable key**
   (**Project Settings → API Keys**) into `SUPABASE_URL` and `SUPABASE_ANON_KEY` in
   `src/config.ts`.
   ⚠️ Never use the secret / `service_role` key in this file.
6. Optional check: **Advisors → Security Advisor** should show no RLS warnings.

### 3. Publish on GitHub Pages
```bash
npm install
git init && git add . && git commit -m "Reel Log"
gh repo create reel-log --public --source=. --remote=origin --push
```
Then on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The `Build and deploy` workflow publishes the site to `https://<you>.github.io/<repo>/`.

In Supabase, **Authentication → URL Configuration**, set **Site URL** to that address.

### 4. Keep Supabase awake
Free Supabase projects pause after a week without use. The included workflow
(`.github/workflows/keepalive.yml`) pings it every 3 days. On GitHub, go to
**Settings → Secrets and variables → Actions** and add:
- `SUPABASE_URL`: same value as in `src/config.ts`
- `SUPABASE_ANON_KEY`: same value as in `src/config.ts`

Then **Actions → Keep Supabase awake → Run workflow** once to check it goes green.
(GitHub turns off scheduled workflows after 60 days with no commits. It emails you;
just re-enable it.)

### 5. Use it on your phone
Open the site in Safari/Chrome and sign in with the same email and password.
Tip: **Share → Add to Home Screen** gives you a full-screen app with its own icon and a
Back button. It also keeps you signed in: plain Safari may sign you out if you don't
visit for about a week. The app has its own storage, so you sign in once more there.

## Notes
- Keys in `src/config.ts` are public by design. The TMDB key is read-only; your lists are
  protected by row-level security in Supabase.
- After a deploy, your phone may show the old version for ~10 minutes (GitHub Pages
  caching). Bumping `?v=` on the CSS and JS links in `index.html` refreshes `styles.css`
  and `app.js` right away; other JS files catch up within a few minutes.
- The Supabase library version is set in two places that must match: `package.json`
  (types for the compiler) and the import map in `index.html` (what the browser loads).
- Movie data and images come from TMDB. This product uses the TMDB API but is not
  endorsed or certified by TMDB.
