# JavaScript → TypeScript migration

A complete record of the commit that switched Reel Log from plain JavaScript to
TypeScript: what changed, why, what deliberately didn't change, how it was tested, and
how to undo it.

For how the TypeScript setup works day to day, see `CODE_GUIDE.md` §3b.

---

## 1. Summary

| | Before | After |
|---|---|---|
| Source code | `js/*.js` (hand-written JavaScript) | `src/*.ts` (TypeScript) |
| What the browser runs | the same `js/*.js` files | `js/*.js` **compiled** from `src/` |
| Build step | none | `tsc` (the TypeScript compiler); no bundler, no framework |
| Type checking | none | `strict` mode; any type error fails the build |
| Publishing | Pages served the `main` branch as-is | GitHub Actions builds, then publishes |
| Your keys | `config.js` | `src/config.ts` |
| Supabase library | CDN, floating version `@2` | same CDN, pinned `@2.117.2`, via an import map |

**The site looks and behaves the same.** Every page, the wheel, sign-in, lists and the
iPhone handling work exactly as before (see §6). The only differences a visitor could
notice are listed in §4.

---

## 2. Why this approach

The goal was TypeScript "without a huge change". Choices made to keep it small:

| Decision | Chosen | Alternative considered | Why |
|---|---|---|---|
| Compiler | `tsc` alone | Vite / esbuild bundler | One `.ts` → one `.js`, same file layout as before. Nothing new to learn beyond "build before testing" |
| Output folder | `js/` | `dist/` | `index.html` keeps loading `js/app.js`, so the HTML barely changed |
| Compiled files in git? | No (`js/` ignored) | Commit `js/` | Generated files in git cause merge noise and can drift out of sync with `src/`. GitHub builds them instead |
| Publishing | GitHub Actions workflow | Commit `js/` and keep "deploy from branch" | Type errors now block a deploy instead of reaching the live site |
| Supabase in the browser | Import map → same CDN | Bundle it into our code | Zero change to how Supabase loads; no bundler needed |
| Supabase types | npm package as a dev dependency | Hand-written types | Exact official types for `createClient`, `User`, `signOut({ scope })`… |
| Database row types | Hand-written in `types.ts`, applied via `run<T>()` | `supabase gen types` full schema | Two small tables; generated types need the Supabase CLI and a login. Easy to adopt later |
| Strictness | `strict: true` from day one | Start loose, tighten later | The codebase is small enough to fix everything now (§5) |

---

## 3. Every file touched

### Renamed and converted (14), moved with `git mv`

| Before | After |
|---|---|
| `config.js` | `src/config.ts` |
| `js/app.js` | `src/app.ts` |
| `js/auth.js` | `src/auth.ts` |
| `js/db.js` | `src/db.ts` |
| `js/ios.js` | `src/ios.ts` |
| `js/tmdb.js` | `src/tmdb.ts` |
| `js/ui.js` | `src/ui.ts` |
| `js/wheel.js` | `src/wheel.ts` |
| `js/views/home.js` | `src/views/home.ts` |
| `js/views/search.js` | `src/views/search.ts` |
| `js/views/movie.js` | `src/views/movie.ts` |
| `js/views/person.js` | `src/views/person.ts` |
| `js/views/lists.js` | `src/views/lists.ts` |
| `js/views/list.js` | `src/views/list.ts` |

Git recognises 11 of these as renames, so `git log --follow src/app.ts` shows the file's
history from before the move. `src/db.ts`, `src/ui.ts` and `src/config.ts` changed enough
(new helpers, typed client, annotated constants) that git lists them as *deleted
`db.js` / `ui.js` / `config.js`* plus *new `.ts` files*. Their old history is still in the
repo under the old names (`git log -- js/db.js`).

### New files (7)

| File | Purpose |
|---|---|
| `src/types.ts` | Interfaces for TMDB responses (`Movie`, `MovieDetails`, `PersonDetails`, `Paged<T>`…), database rows (`List`, `ListItem`, `ListMembership`) and the router's `ViewContext` |
| `package.json` | Scripts (`build`, `watch`, `typecheck`, `serve`) and dev dependencies: `typescript ^7.0.2`, `@supabase/supabase-js 2.117.2` (types only) |
| `package-lock.json` | Exact versions npm installed, so GitHub builds with the same ones |
| `tsconfig.json` | Compiler settings: `src/` → `js/`, ES2022 modules, `strict`, `noEmitOnError`, source maps |
| `.gitignore` | Ignores `node_modules/`, `js/` (generated), `_site/` (deploy temp), `.DS_Store` |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci` → `npm run build` → publish `index.html`, `styles.css`, `manifest.webmanifest`, `icons/`, `js/` to Pages |
| `TYPESCRIPT_MIGRATION.md` | This document |

### Modified (3)

| File | Change |
|---|---|
| `index.html` | Added an **import map** that maps `"@supabase/supabase-js"` to `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm`, with comments. Bumped cache-busters `styles.css?v=1 → v=2` and `js/app.js?v=1 → v=2` so phones fetch the new build. Everything else is identical |
| `README.md` | New "Everyday workflow" section (`npm install` / `watch` / `serve` / push), command table, config path now `src/config.ts`, Pages source now "GitHub Actions", live site link, note about keeping the Supabase version in sync. Kept your TMDB username note |
| `CODE_GUIDE.md` | New §3b "TypeScript and the build" (how compiling works, `package.json`, every `tsconfig` setting, strict-mode patterns, `types.ts`, the import map, `deploy.yml`, `.gitignore`). All file references `.js → .ts`. File map shows `src/` (edit) vs `js/` (generated). `run<T>`, `tmdb<T>`, `byId`/`find`/`errorMessage` documented. New gotchas #13–15. Design-decision table updated |

### Deleted (1)

| File | Why |
|---|---|
| `.nojekyll` | It told GitHub Pages to skip Jekyll processing. Pages now publishes the artifact built by `deploy.yml`, which never goes through Jekyll, so the file no longer did anything |

### Unchanged

`styles.css`, `manifest.webmanifest`, `icons/*`, `supabase/schema.sql`,
`.github/workflows/keepalive.yml`, and `reel-log-spec.md`.

### GitHub settings changed (outside the repo)

| Setting | Before | After |
|---|---|---|
| Settings → Pages → Build and deployment → Source | Deploy from a branch (`main` / root) | **GitHub Actions** |

---

## 4. Behaviour differences (all small)

1. **Setup and error messages point to the new file.** "Check TMDB_API_KEY in
   `src/config.ts`", and the setup notices now say "then run `npm run build`".
2. **Supabase is pinned to 2.117.2** instead of "latest 2.x". The browser now runs exactly
   the version the code was type-checked against. Upgrading is deliberate: change
   `package.json` and the import map together.
3. **Only site files are published.** Before, every file in the repo was reachable on the
   website (e.g. `…/reel-log/README.md`, `…/supabase/schema.sql`). Now only `index.html`,
   `styles.css`, `manifest.webmanifest`, `icons/` and `js/` are. The repo itself is still
   public on GitHub.
4. **`openWheel([])` now does nothing** instead of drawing an empty wheel. Unreachable in
   practice, since the Randomize buttons are disabled below 2 films. It's a small safety
   guard added during the conversion.
5. **Clearer failures if the HTML changes.** If `index.html` ever lost an element the code
   needs (e.g. `#search-input`), the console now says `index.html is missing #search-input`
   instead of a vague "cannot read properties of null".
6. **Source maps are published** (`js/*.js.map`). Browser dev tools on the live site show
   the original TypeScript. They're only downloaded when dev tools are open.

---

## 5. Code changes, file by file

The conversion rule was: **same logic, add types, and handle every case `strict` mode
flags.** Four patterns account for almost all edits:

```ts
// A. Elements index.html always has → byId(), typed, fails loudly if missing
const searchInput = byId<HTMLInputElement>("search-input");   // was document.getElementById(...)

// B. Elements a view just drew → find(), same idea inside a container
const spinBtn = find<HTMLButtonElement>(ctx.el, "#spin");     // was ctx.el.querySelector(...)

// C. catch (err) is `unknown` → errorMessage(err)
} catch (err) { toast(errorMessage(err)); }                   // was toast(err.message)

// D. Event targets → say what they are
(e.target as Element).closest("[data-remove]")               // was e.target.closest(...)
```

| File | What changed |
|---|---|
| `src/types.ts` | **New.** All shared interfaces (see §3) |
| `src/config.ts` | Constants annotated `: string` (otherwise TypeScript types each as its one literal value). Header comment says to rebuild after editing. Your keys are unchanged |
| `src/tmdb.ts` | `tmdb()` became generic, `tmdb<T>(path, params): Promise<T>`, so callers state the response shape. `params` typed `Record<string, string \| number>`, values passed through `String()`. `res` typed `Response`. `img()` returns `string \| null`. Imports `./config.js` (was `../config.js`, since config moved into `src/`). 401 message now names `src/config.ts` |
| `src/ui.ts` | Parameters and return types added. `ESCAPES` typed as a lookup table. **New helpers:** `byId<T>()`, `find<T>()`, `errorMessage()` (patterns A–C). `posterCard` accepts `Movie \| ListItem` and tells them apart with `"tmdb_id" in movie` (was `movie.tmdb_id ?? movie.id`). `toastTimer` typed `number \| undefined` |
| `src/db.ts` | Imports `createClient` from `"@supabase/supabase-js"` (resolved by the import map), not the CDN URL. `supabase` typed `SupabaseClient \| null`. **New `client()` helper** returns the client or throws "Lists are temporarily unavailable", so queries never touch `null`. `run()` became generic `run<T>()`. Every query function has a declared return type (`Promise<List[]>`, `Promise<List \| null>`…) |
| `src/auth.ts` | `user` typed with Supabase's `User`. All DOM lookups via `byId` (email/password inputs looked up once instead of on each submit). The sign-in handler and `initAuth` return early if `supabase` is null; sign-out uses `supabase?.` |
| `src/ios.ts` | `navigator.standalone` is Apple-only and missing from TypeScript's DOM types, so it's read through a typed alias (`Navigator & { standalone?: boolean }`). Return types added |
| `src/wheel.ts` | `Colors` tuple type (`[fill, ink]`). `xy()` returns `[string, string]`. `shuffle` is generic `<T>`. `openWheel(items: readonly ListItem[])`. Element lookups via `find`. **New guard:** returns immediately for an empty list (§4.4) |
| `src/app.ts` | Route table typed `[RegExp, View, Needs][]`; `Needs = "tmdb" \| "db"`. `ctx` typed `ViewContext`. `render()` returns `Promise<void>`. Early `return ctx.show(...)` lines became `ctx.show(...); return;` so the function has one return type. The regex match is asserted non-null, with a comment explaining why that's safe. `history.state?.idx` read as `unknown` and checked with `typeof`. Setup notices mention `src/config.ts` and `npm run build` |
| `src/views/home.ts` | `tmdb<Paged<Movie>>(…)`; `ctx: ViewContext` |
| `src/views/search.ts` | `tmdb<Paged<Movie>>`, `Set<number>`, typed `cards()`. `#results`/`#more-row` via `find`. Load-more error via `errorMessage` |
| `src/views/movie.ts` | `tmdb<MovieDetails>`. `RELEASE_TYPES: Record<number, string>`. `releaseRows()` returns `[string, string][]`. Typed helpers (`runtime`, `personLinks`, `castCard`). In the list panel: checkbox list typed `HTMLInputElement`; `box.dataset.list ?? ""`; `nextElementSibling?.textContent ?? ""`; the Create button and input are looked up once with `find` |
| `src/views/person.ts` | `tmdb<PersonDetails>`. `filmography()` returns `Movie[]`. The facts list uses a **type guard**, `.filter((fact): fact is string => Boolean(fact))`, so TypeScript knows the empty entries are gone. The bio toggle checks both elements exist before using them |
| `src/views/lists.ts` | `listCard(list: List)`. Form, input and button via `find`. Spin click uses `closest<HTMLElement>` so `dataset` is typed |
| `src/views/list.ts` | `#list-name`, `#list-count`, `#spin`, `#rename`, `#delete` via `find` (`#list-count` now looked up once, not on every removal). The remove handler reads `tmdbId` once, and uses `card?.` / `?? "film"` in case the markup changes |

**Size of the change:** the compiled `js/*.js` is essentially the old JavaScript. The
diff between old and compiled `wheel.js`, for example, is the `find()` calls, the
empty-list guard, and whitespace.

---

## 6. How it was tested

| Check | How | Result |
|---|---|---|
| Compiles under `strict` | `npx tsc` | ✅ 0 errors |
| Strict checks are really on | Planted three errors (string into a number, untyped parameter, possible `null`) in a temporary file | ✅ all three reported, build refused; file deleted |
| Output matches the old code | Diffed original `js/wheel.js` against the compiled one | ✅ only the intended changes |
| Import map loads Supabase | Loaded the compiled site, queried Supabase from the page | ✅ client loaded from `@2.117.2`; your project answered 200 |
| Real TMDB data | Home, search ("inception") + Load more, Inception page, Leonardo DiCaprio page | ✅ 20 trending; 12 results; director, US release dates, 20 cast; 92 films |
| Signed out | My Lists page; "Add to list" on a movie | ✅ sign-in prompt; sign-in dialog opens |
| Signed in (fake Supabase, iPhone Home Screen app mode) | My Lists cards, Randomize from a card, wheel spin, open list, remove a film, ‹ Back | ✅ 2 cards (Randomize disabled on the 1-film list); wheel landed on the announced film; count 6 → 5; Back returned to My Lists |
| Console | Chrome dev tools during all of the above | ✅ no errors |
| Look | Screenshot of the movie page | ✅ unchanged |
| `npm run watch` on TypeScript 7 | Started watch mode | ✅ "Found 0 errors. Watching for file changes." |
| Deploy | Push → Actions "Build and deploy" → live site | ✅ checked after pushing (see the commit's Actions run) |

**Not tested here:** signing in with your real account (that would mean typing your
password), and a real iPhone. Check both on the live site.

---

## 7. How you work now

```bash
npm install          # once per clone
npm run watch        # leave running; recompiles on save
npm run serve        # second terminal → http://localhost:8000
# edit src/*.ts … check in the browser …
git add -A && git commit -m "…" && git push   # GitHub builds + deploys (~1 min)
```

- Edit **`src/`**, never `js/`. It's regenerated and not in git.
- A red ✕ on **Actions → Build and deploy** means a type error. The live site stays on the
  last good version. Run `npm run typecheck` locally to see the errors.
- Changing keys: edit `src/config.ts`, then push. Locally, `watch` picks it up.

---

## 8. How to undo it

The previous version is the commit before this one. To go back completely:

```bash
git revert <this commit's hash>   # restores js/, config.js, .nojekyll; removes src/, deploy.yml, package.json…
git push
```

Then on GitHub, switch **Settings → Pages → Source** back to **Deploy from a branch →
`main` / root**. That order matters: with no `deploy.yml`, "GitHub Actions" has nothing
to publish. `git revert` adds a new commit rather than erasing this one, so the
TypeScript version stays in history if you want it back.
