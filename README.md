# Reel Log

A personal Letterboxd-style movie site with a movie-palace poster-wall theme. Search films,
see cast and release dates, keep lists that sync between your phone and computer, and
press **🎡 Randomize** on any list to spin a wheel that picks tonight's movie. Works the
same on your computer and your iPhone (including as a Home Screen app).

Plain HTML/CSS/JS — no build step. Hosted free on GitHub Pages, movie data from TMDB,
sign-in and lists stored in Supabase. See `CODE_GUIDE.md` for how every file works.

## Setup (about 15 minutes)

### 1. TMDB API key (movie data)
1. Create a free account at <https://www.themoviedb.org/signup>. User: carterb11220
2. Go to **Settings → API** and request a developer key (personal use).
3. Copy the **API Key** (or the longer **API Read Access Token** — either works) into
   `TMDB_API_KEY` in `config.js`.

### 2. Supabase (sign-in + your lists)
1. Create a free project at <https://supabase.com/dashboard>.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**.
3. **Authentication → Users → Add user → Create new user**: enter your email and a
   password, and tick **Auto Confirm User**. This is the login you'll use on every device.
4. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
   The site is just for you, so nobody else should be able to create an account.
5. **Project Settings → API**: copy the **Project URL** and the **anon / publishable**
   key into `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`.
   ⚠️ Never use the `service_role` / secret key in this file.
6. Optional check: **Advisors → Security Advisor** should show no RLS warnings.

### 3. Publish on GitHub Pages
```bash
cd /path/to/Movie
git init && git add . && git commit -m "Reel Log"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch →
`main` / `(root)`**. After a minute your site is at `https://<you>.github.io/<repo>/`.

In Supabase, **Authentication → URL Configuration**, set **Site URL** to that address.

### 4. Keep Supabase awake
Free Supabase projects pause after a week without use. The included workflow
(`.github/workflows/keepalive.yml`) pings it every 3 days. On GitHub, go to
**Settings → Secrets and variables → Actions** and add:
- `SUPABASE_URL` — same value as in `config.js`
- `SUPABASE_ANON_KEY` — same value as in `config.js`

Then **Actions → Keep Supabase awake → Run workflow** once to check it goes green.
(GitHub turns off scheduled workflows after 60 days with no commits — it emails you;
just re-enable it.)

### 5. Use it on your phone
Open the site in Safari/Chrome and sign in with the same email and password.
Tip: **Share → Add to Home Screen** gives you a full-screen app with its own icon and a
Back button. It also keeps you signed in: plain Safari may sign you out if you don't
visit for about a week. The app has its own storage, so you sign in once more there.

## Running locally
ES modules need a web server (opening `index.html` directly won't work):
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Notes
- Keys in `config.js` are public by design. The TMDB key is read-only; your lists are
  protected by row-level security in Supabase.
- After pushing changes, your phone may show the old version for ~10 minutes (GitHub
  Pages caching). Bumping `?v=1` in `index.html` refreshes `styles.css` and `app.js`
  right away; other JS files catch up within a few minutes.
- Movie data and images come from TMDB. This product uses the TMDB API but is not
  endorsed or certified by TMDB.
