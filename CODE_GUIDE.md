# Reel Log — Code Guide

A file-by-file walkthrough of everything in this project: what each file does, how the
pieces connect, and worked examples for the parts that aren't obvious.

The code is **TypeScript**. You edit `src/*.ts`; the compiler writes plain JavaScript to
`js/*.js`, which is what the browser runs. §3b explains the build, and
`TYPESCRIPT_MIGRATION.md` records exactly what changed when the project switched from
JavaScript.

It also records *why* things were built this way: the design decisions (§12) and the
known limits and gotchas (§13). For setup steps, see `README.md`.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [File map](#2-file-map)
3. [Root files](#3-root-files) — `index.html`, `src/config.ts`, `styles.css`, `manifest.webmanifest`, `icons/`
3b. [TypeScript and the build](#3b-typescript-and-the-build) — `package.json`, `tsconfig.json`, `src/types.ts`, `deploy.yml`, `.gitignore`
4. [Core code](#4-core-code) — `app.ts`, `tmdb.ts`, `db.ts`, `auth.ts`, `ui.ts`, `ios.ts`
5. [Views](#5-views) — home, search, movie, person, lists, list
6. [The wheel](#6-the-wheel--srcwheelts) — `wheel.ts`
7. [Backend & automation](#7-backend--automation) — `schema.sql`, `keepalive.yml` (`deploy.yml` is in §3b)
8. [Docs](#8-docs) — `README.md`, this file
9. [Walkthroughs: what happens when…](#9-walkthroughs-what-happens-when)
10. [How to extend it](#10-how-to-extend-it)
11. [iPhone vs computer: every difference and how it's handled](#11-iphone-vs-computer-every-difference-and-how-its-handled)
12. [Design decisions and what they cost](#12-design-decisions-and-what-they-cost)
13. [Known limits and gotchas](#13-known-limits-and-gotchas)
14. [Feature checklist](#14-feature-checklist)

---

## 1. The big picture

There is **no server of our own**. GitHub Pages only hands out static files. Everything
dynamic happens in your browser, talking directly to two outside services:

```
                       ┌──────────────────────────────┐
                       │  GitHub Pages                │
                       │  (serves index.html, css, and│
                       │   js/ compiled from src/*.ts)│
                       └──────────────┬───────────────┘
                                      │ page load
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Your browser (phone or computer)                               │
│                                                                 │
│   index.html ──► js/app.js (router)                             │
│                     │                                           │
│         ┌───────────┼────────────────────┐                      │
│         ▼           ▼                    ▼                      │
│    js/views/*   js/auth.js          js/wheel.js                 │
│     │      │        │                                           │
│     ▼      ▼        ▼                                           │
│  js/tmdb.js   js/db.js ◄── supabase-js (CDN, via import map)    │
└─────┬──────────────┬────────────────────────────────────────────┘
      │              │
      ▼              ▼
┌───────────┐  ┌─────────────────────────────────────┐
│  TMDB API │  │  Supabase                           │
│  movies,  │  │  • Auth: email + password sessions  │
│  cast,    │  │  • Postgres: lists, list_items      │
│  posters  │  │  • Row-level security = only you    │
└───────────┘  └─────────────────────────────────────┘
```

- **The diagram shows `js/` files** because that's what the browser runs. Each one is
  compiled from the `.ts` file of the same name in `src/`.
- **TMDB** gives us everything about movies: search results, posters, cast, release dates.
  We never store movie data ourselves (except a tiny snapshot in lists — see §7).
- **Supabase** gives us sign-in and a database. Because your lists live there (not in the
  browser), your phone and computer see the same data.
- **Routing** uses the part of the URL after `#` (e.g. `…/#/movie/27205`). GitHub Pages
  can't do server-side routing, but everything after `#` never reaches the server, so
  refreshes and shared links always work.

---

## 2. File map

```
Movie/
├── index.html                  Page shell: header, <main>, footer, sign-in dialog
├── styles.css                  The whole theater theme + responsive layout
├── package.json                npm scripts (build/watch/typecheck/serve) + TypeScript version
├── package-lock.json           Exact installed versions (npm writes this; don't edit)
├── tsconfig.json               TypeScript compiler settings: src/ → js/, strict checks
├── .gitignore                  Keeps node_modules/ and the compiled js/ out of git
├── manifest.webmanifest        Home Screen app name, colours, icons
├── icons/                      App icons (film reel): 180px iPhone, 192px, 512px
├── src/                        ✏️ THE CODE YOU EDIT (TypeScript)
│   ├── config.ts               Your keys (TMDB, Supabase) — the only file you edit to set up
│   ├── types.ts                Shapes of TMDB + database data, and the view context
│   ├── app.ts                  Entry point: router, header search, render tokens
│   ├── tmdb.ts                 TMDB fetch wrapper + image URL helper
│   ├── db.ts                   Supabase client + every database query
│   ├── auth.ts                 Sign-in dialog, header avatar, session tracking
│   ├── ui.ts                   Shared HTML helpers: escaping, poster cards, toasts, DOM lookups
│   ├── wheel.ts                "Randomize" spinning wheel
│   ├── ios.ts                  iPhone detection + "Add to Home Screen" tip
│   └── views/
│       ├── home.ts             Trending films wall
│       ├── search.ts           Search results + "Load more"
│       ├── movie.ts            Movie detail + "Add to list" panel
│       ├── person.ts           Actor/director page + filmography
│       ├── lists.ts            "My Lists" overview + create form
│       └── list.ts             One list: posters, remove, rename, delete, wheel
├── js/                         ⚙️ GENERATED by `npm run build` — never edit, not in git
│   └── (one .js + .js.map per src/ file)
├── supabase/
│   └── schema.sql              Database tables + security rules (run once)
├── .github/workflows/
│   ├── deploy.yml              On every push: type-check, compile, publish to Pages
│   └── keepalive.yml           Pings Supabase every 3 days so it doesn't pause
├── README.md                   Setup instructions
├── CODE_GUIDE.md               This file
└── TYPESCRIPT_MIGRATION.md     Record of the JavaScript → TypeScript switch
```

**Dependency direction** (who imports whom) — arrows point at the thing being imported.
Almost every file also imports *types* from `types.ts` (`import type …`), which vanish
when compiled, so they're left off the chart:

```
app.ts ──► views/*.ts ──► tmdb.ts ──► config.ts
   │           │    └───► db.ts ────► config.ts, supabase-js (CDN)
   │           ├────────► auth.ts ──► db.ts, ui.ts
   │           ├────────► ui.ts ────► tmdb.ts
   │           ├────────► wheel.ts ─► ui.ts   (list.ts, lists.ts)
   │           └────────► ios.ts               (lists.ts)
   └──► auth.ts, tmdb.ts, db.ts, ui.ts, ios.ts
```

Nothing imports `app.ts`, which keeps the graph free of cycles.

---

## 3. Root files

### `index.html` — the page shell

This is the only HTML page. It never changes while you use the site; JavaScript swaps
the contents of `<main id="app">` for each "page".

| Part | Purpose |
|---|---|
| `<meta name="viewport" … viewport-fit=cover>` | Makes the layout fit phones, including the notch area on iPhones |
| `<meta name="theme-color" content="#3a0a0f">` | Tints the phone browser's address bar the same red as the ceiling |
| `apple-mobile-web-app-*` metas | Make "Add to Home Screen" on iOS open full-screen, like an app, named "Reel Log" |
| `apple-touch-icon`, `manifest` links | The film-reel icon on the Home Screen (iOS uses the 180px PNG; Android and desktop Chrome read the manifest) |
| `format-detection` | Stops iOS turning numbers (like years or runtimes) into tappable phone links |
| `.brand` → `#back-btn` | A ‹ Back button, hidden except in the iPhone Home Screen app (see `app.ts`) |
| Google Fonts link | Loads **Limelight** (art-deco marquee titles), **Bebas Neue** (tall poster lettering for headings/buttons), **Inter** (body text) |
| `styles.css?v=2` | The `?v=` is a cache-buster: bump the number after changes so phones fetch the new file |
| `<header class="topbar">` | Logo, search box, "My Lists" link, and `#auth-slot` (filled in by `auth.ts` with Sign in / avatar + Sign out) |
| `<main id="app">` | Empty — every view renders into here |
| `<footer class="footer">` | TMDB attribution (required by TMDB's terms), styled as red carpet |
| `<dialog id="auth-dialog">` | The sign-in popup. `<form method="dialog">` around the ✕ button means clicking it closes the dialog with no JavaScript |
| `<script type="importmap">` | Tells the browser where `"@supabase/supabase-js"` lives (the jsDelivr CDN, pinned to 2.117.2). See §3b |
| `<script type="module" src="js/app.js?v=2">` | Starts everything. It loads the **compiled** `src/app.ts`, not `src/app.ts`. `type="module"` enables `import`/`export` and top-level `await` |

### `src/config.ts` — your keys

The only file you need to edit to set up the site. Three values:

```ts
export const TMDB_API_KEY: string = "YOUR_TMDB_API_KEY";
export const SUPABASE_URL: string = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY: string = "YOUR_SUPABASE_ANON_KEY";
```

`: string` tells TypeScript these are ordinary strings. Without it, TypeScript would
treat each as the one exact piece of text written there. After editing, run
`npm run build`, or keep `npm run watch` running, so `src/config.ts` picks up the change.
On GitHub the deploy workflow compiles it for you.

**"Isn't it bad to put keys in a public file?"** Not these ones:

- The **TMDB key** can only *read* public movie data. Worst case, someone uses up its
  rate limit and you generate a new one.
- The **Supabase anon key** is designed to be public. It only identifies your project.
  What protects your data is the row-level security in `schema.sql`, which checks *who
  is signed in* on every single query.
- The Supabase **service_role / secret** key bypasses all security. It must **never**
  go in this file (there's a warning comment saying so).

While the placeholders (`YOUR_…`) are still there, the site doesn't crash. It shows a
friendly "add your key" notice instead. `tmdb.ts` and `db.ts` detect the placeholders.

### `styles.css` — the movie-palace theme

About 430 lines, organised in labelled sections. The concept, based on the poster-gallery
photo: **plum walls, red ceiling with recessed downlights, posters in black lacquer frames
with brass trim, marquee lettering, red carpet underfoot.**

#### Design tokens (`:root`)

Every colour is a CSS variable, so re-theming means changing about 15 lines:

| Variable | Colour | Used for |
|---|---|---|
| `--wall` / `--wall-2` | deep aubergine | page background |
| `--panel` / `--panel-2` | lighter plum | boxes, dialogs, inputs |
| `--ceiling` / `--ceiling-2` | dark red | header |
| `--brass` / `--brass-2` | gold | frame trim, headings, primary buttons |
| `--red` / `--red-2` | velvet red | carpet footer, wheel button |
| `--text` / `--muted` | cream / dusty pink-grey | text |

#### Section by section

| Section | What it does | Technique |
|---|---|---|
| **body** | The wall | Three stacked backgrounds: (1) a soft light pool every 260px across the top, like downlights shining on the wall; (2) faint 7px vertical stripes like fabric panels; (3) darker edges at top and bottom |
| **Ceiling / top bar** | Sticky red header | `position: sticky` keeps it on screen. `::after` draws a row of glowing dots along the bottom edge (the downlights), using one `radial-gradient` repeated every 260px |
| `.logo` | Glowing gold "Reel Log" | Two `text-shadow`s, one tight and one wide, make a neon/marquee glow |
| **Buttons** | `.btn`, `.btn-accent` (gold), `.btn-red`, `.btn-danger`, `.btn-sm` | Bebas Neue lettering; gold buttons use a vertical gradient to look like polished brass |
| `.section-title` | "NOW SHOWING ───" headings | Flexbox with `::after { flex: 1 }` draws a gold line that fills the rest of the row |
| **Poster wall** | `.grid`, `.card`, `.poster` | See the breakdown below |
| **Movie detail** | Backdrop, poster, facts | Backdrop gets a slight `sepia()` filter for a vintage feel. The poster column is `position: sticky` on desktop so it stays visible while you scroll the cast |
| **Add-to-list panel** | Checkbox list | `accent-color: var(--brass)` makes native checkboxes gold |
| **Lists** | Fanned poster stacks | Negative `margin-left` overlaps posters. On hover each one shifts and rotates a little more (`translateX(8px) rotate(2deg)`, then 16px/4deg, 24px/6deg), like cards fanning out |
| **Person** | Photo + bio | `.bio.clamped` uses `-webkit-line-clamp: 6` to cut off after 6 lines, with a "Read more" button |
| **Dialogs** | Sign-in and wheel popups | Gold border plus a 4px black outer ring (drawn with `box-shadow`) = a framed look |
| **Wheel** | Marquee sign, pointer, spin | See §6 |
| **Footer** | Red carpet | `repeating-conic-gradient` makes a red checkerboard, with a small dark dot pattern on top, like the patterned carpet in the photo |
| `.toast` | Little pop-up messages | Fixed to the bottom centre, slides up on appear |

#### Breakdown: how a framed poster is drawn

No images are used for the frame. It's built from three CSS layers on the same element:

```css
.card .poster {
  border: 6px solid #0b0909;                 /* 1. thick black lacquer frame        */
  outline: 1px solid rgba(226,176,74,.55);   /* 2. thin brass line…                 */
  outline-offset: -7px;                      /*    …pulled INSIDE the frame         */
  box-shadow:
    0 0 0 1px #2b2224,                       /* 3a. hairline edge around the frame  */
    0 18px 26px -10px rgba(0,0,0,.9),        /* 3b. deep shadow below (hung on wall)*/
    0 4px 8px rgba(0,0,0,.5);                /* 3c. soft contact shadow             */
}
```

```
 ┌───────────────────────┐  ← 3a hairline
 │███████████████████████│  ← 1  6px black border
 │██┌─────────────────┐██│  ← 2  brass outline, offset -7px (sits just inside)
 │██│                 │██│
 │██│   poster image  │██│
 │██│                 │██│
 │██└─────────────────┘██│
 │███████████████████████│
 └───────────────────────┘
      ░░░░░░░░░░░░░░░░       ← 3b shadow falls below
```

**The spotlight above each poster** is a `.card::before` pseudo-element: a warm
`radial-gradient` that sits *behind* the card (`z-index: -1`) and extends 34px above it.
`.grid { isolation: isolate }` stops that `-1` from slipping behind the whole page. On
hover the spotlight brightens and the frame lifts 4px with a gold glow.

#### iPhone-safe CSS (same look on both)

| Rule | iPhone problem it avoids |
|---|---|
| Wall lighting on a `position: fixed` `body::before` layer | iOS Safari ignores `background-attachment: fixed`; the lights would scroll away |
| `min-height: 100dvh` (after a `100vh` fallback) | `100vh` on iPhone is taller than the visible area when Safari's toolbars show |
| Every `:hover` rule wrapped in `@media (hover: hover)` | On touch, a tapped poster would stay "lifted" after you tap it |
| `:active` styles (`.card:active .poster { scale(.97) }` …) | Gives touch a press response, since there's no hover |
| `touch-action: manipulation` on links/buttons | Removes the double-tap-to-zoom delay, so taps feel instant (e.g. spinning the wheel) |
| `-webkit-tap-highlight-color: transparent` | No grey flash box on every tap |
| `max(16px, env(safe-area-inset-left/right))` padding | Content stays clear of the notch in landscape |
| `html:has(dialog[open]) { overflow: hidden }` | The page behind the sign-in/wheel dialog doesn't scroll on iPhone |
| `.wheel-wrap` width `min(340px, 100%, 46dvh)` | The wheel + button fit on short iPhones (SE) without scrolling |
| Inputs at `font-size: 16px` | iOS zooms the whole page into smaller inputs |

#### Responsive breakpoints

| Width | What changes |
|---|---|
| ≤ 720px | Movie detail: small poster beside the title, everything else full-width below. `.detail-body { display: contents }` lets its children join the parent grid directly |
| ≤ 640px | Header: search box drops to its own full-width row |
| ≤ 560px | Person page: smaller photo column |
| ≤ 480px | Poster grids become exactly 3 columns; frames get thinner |
| ≤ 380px | Avatar circle hides to save space |

Inputs use `font-size: 16px`, because iOS zooms the page when you tap an input with smaller
text.

`@media (prefers-reduced-motion: reduce)` shortens the wheel spin and stops the blinking
bulbs for people who have reduced motion turned on in their OS.

### `manifest.webmanifest` and `icons/`

The manifest tells browsers how to install the site as an app:

```json
{ "name": "Reel Log", "start_url": "./", "scope": "./", "display": "standalone",
  "background_color": "#1e1219", "theme_color": "#3a0a0f", "icons": [ … ] }
```

- `start_url: "./"` and `scope: "./"` are **relative**, so they work at
  `you.github.io/<repo>/` no matter what the repo is called.
- `display: "standalone"` launches full-screen, with no browser toolbar.
- `icons/` holds a gold film reel on theater red, generated at three sizes:
  `apple-touch-icon.png` (180px, what iPhones use), `icon-192.png`, and `icon-512.png`
  (also marked `maskable`, with the reel kept inside the central safe zone so Android's
  round crop doesn't clip it). The icons fill the whole square, because iOS adds its own
  rounded corners and would show transparency as black.

> **`.nojekyll` was removed.** It told GitHub Pages to skip its Jekyll processing
> step. The site is now published by the `deploy.yml` workflow, which never runs
> Jekyll, so the file had nothing left to do.

---

## 3b. TypeScript and the build

### How it fits together

```
 you edit              npm run build / watch            browser loads
┌──────────────┐        (tsc, the TypeScript         ┌──────────────┐
│ src/app.ts   │ ─────► compiler: checks types, ───► │ src/app.ts    │
│ src/db.ts    │        then strips them out)        │ src/db.ts     │
│ src/views/…  │                                     │ js/views/…   │
└──────────────┘                                     └──────────────┘
```

- **One `.ts` file becomes one `.js` file** with the same name and folder. There's no
  bundler (like Vite or webpack) combining files. `tsc` just removes the type
  annotations and writes each file out.
- **Imports keep saying `.js`**, even inside `.ts` files: `import { tmdb } from "./tmdb.js"`.
  That's deliberate. The import is written for the *compiled* file the browser will
  fetch. TypeScript knows `./tmdb.js` means `src/tmdb.ts` while it checks types.
- **Type-only imports use `import type`**: `import type { Movie } from "./types.js"`.
  They are erased completely, so the browser never downloads `types.ts` for them.
- **`.js.map` source maps** are written next to each file. In browser dev tools, errors
  and breakpoints show your original TypeScript lines, not the compiled output.

### `package.json`: the project's toolbox

```json
"scripts": {
  "build": "tsc",              // compile once
  "watch": "tsc --watch",      // compile on every save
  "typecheck": "tsc --noEmit", // check only, write nothing
  "serve": "python3 -m http.server 8000"
},
"devDependencies": {
  "@supabase/supabase-js": "2.117.2",   // types only (see the import map below)
  "typescript": "^7.0.2"
}
```

"devDependencies" means these are only needed to *build* the site. None of it is
shipped to the browser. `npm install` downloads them into `node_modules/`, and
`package-lock.json` records exact versions so GitHub's build uses the same ones.

### `tsconfig.json`: compiler settings

| Setting | Value | Why |
|---|---|---|
| `rootDir` / `outDir` | `src` → `js` | Where TypeScript reads from and writes to. `js/` keeps the old path, so `index.html` barely changed |
| `target` / `module` | `ES2022` | Modern JavaScript with `import`/`export` and top-level `await`, which every current browser (including iOS Safari) runs |
| `moduleResolution` | `bundler` | Lets imports say `./tmdb.js` while checking `tmdb.ts`, and finds Supabase's types in `node_modules` |
| `lib` | `ES2022, DOM, DOM.Iterable` | Browser APIs (`document`, `fetch`, `localStorage`…) are known to TypeScript |
| `types` | `[]` | Don't pull in Node.js types. This code runs in a browser, so `setTimeout` returns a number, not a Node timer |
| `strict` | `true` | The full set of safety checks: no implicit `any`, and `null` must be handled (see below) |
| `noEmitOnError` | `true` | If there's any type error, write **nothing**. A broken build can't half-update `js/` |
| `verbatimModuleSyntax` | `true` | Forces `import type` for type-only imports, so it's obvious what exists at runtime |
| `sourceMap` + `inlineSources` | `true` | Dev tools show your TypeScript source, even on the live site |
| `skipLibCheck` | `true` | Don't re-check the Supabase library's own type files. Faster, and not our code |

### What `strict` made the code do

Strict mode insists every "might be missing" case is handled. The main patterns:

```ts
// 1. Elements that index.html always has: byId() fails loudly if one goes missing
const searchInput = byId<HTMLInputElement>("search-input");

// 2. Elements a view just rendered: find() does the same inside a container
const spinBtn = find<HTMLButtonElement>(ctx.el, "#spin");

// 3. Genuinely optional things keep ?. (optional chaining)
ctx.el.querySelector("#items")?.addEventListener("click", …);

// 4. catch (err) is `unknown` in TypeScript: errorMessage() turns it into text
} catch (err) { toast(errorMessage(err)); }

// 5. Event targets are generic, so we say what they are
const button = (e.target as Element).closest<HTMLButtonElement>("[data-remove]");
```

The `<HTMLInputElement>` part is a **type argument**: it tells TypeScript which kind of
element to expect, so `.value` and `.disabled` are allowed.

### `src/types.ts`: the shapes of our data

Interfaces describe what TMDB and the database send back, listing only the fields we use:

| Type | What it describes | Used by |
|---|---|---|
| `Movie` | A film in search results, trending, filmographies | search, home, person, `posterCard` |
| `Paged<T>` | One page of TMDB results (`results: T[]`, `total_pages`…) | search, home |
| `MovieDetails` | `/movie/{id}` with credits + release dates | movie view |
| `CastMember`, `CrewMember`, `ReleaseDate` | Parts of `MovieDetails` | movie view |
| `PersonDetails` | `/person/{id}` with filmography | person view |
| `ListItem`, `List`, `ListMembership` | Rows from our Supabase tables | `db.ts`, lists, list, wheel |
| `ViewContext` | The `ctx` object every view receives | `app.ts` and all views |

Fields that can really be empty are typed that way, e.g. `poster_path: string | null`.
The compiler then refuses code that uses a poster path without checking for `null`
first.

TypeScript **trusts** these shapes. It can't check what TMDB actually sends at runtime.
If TMDB renamed a field, the compiler wouldn't know; `types.ts` is where you'd update it.

### The import map: Supabase without a bundler

`db.ts` imports Supabase by its package name so TypeScript can find its types:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
```

A browser doesn't know what `"@supabase/supabase-js"` means. The **import map** in
`index.html` tells it:

```html
<script type="importmap">
  { "imports": { "@supabase/supabase-js": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm" } }
</script>
```

So the browser still downloads Supabase from the same CDN as before, and the compiler
checks our code against the same version's types. **Keep the two version numbers equal**
(here and in `package.json`) when upgrading.

### `.github/workflows/deploy.yml`: build and publish on every push

```
git push ─► GitHub Actions
             ├─ build job:  checkout → install Node 24 → npm ci → npm run build
             │              → copy index.html, styles.css, manifest, icons/, js/ into _site/
             │              → upload _site/ as the Pages artifact
             └─ deploy job: publish that artifact to https://carterbris-1.github.io/reel-log/
```

- **Type errors block the deploy.** `npm run build` fails, so the deploy job never runs
  and the live site keeps the last good version.
- **Only site files are published.** `src/`, the docs, `supabase/` and `node_modules/`
  stay in the repo but aren't served on the website.
- **`npm ci`** installs exactly what `package-lock.json` says, so GitHub builds with the
  same versions you have.
- **`concurrency: pages`** means two quick pushes deploy one after the other rather than
  colliding.
- It needs **Settings → Pages → Source: GitHub Actions** (already set for your repo).

### `.gitignore`

| Ignored | Why |
|---|---|
| `node_modules/` | Hundreds of downloaded files; `npm install` recreates them |
| `js/` | Generated output; the deploy workflow rebuilds it from `src/` |
| `_site/` | Temporary folder the deploy workflow assembles |

Because `js/` isn't in git, a fresh clone has no `js/` folder until you run
`npm install && npm run build`.

---

## 4. Core code

### `src/app.ts` — the entry point and router

The first script that runs. Four jobs:

1. **Map URLs to views** (the router)
2. **Make sure slow responses can't overwrite newer pages** (render tokens)
3. **Run the header search box** (debounce + history handling)
4. **Start auth, then render the first page**

#### 1. The route table

```js
const routes = [
  [/^$/,                       (ctx)    => homeView(ctx),                          "tmdb"],
  [/^search\/(.+)$/,           (ctx, m) => searchView(ctx, decodeURIComponent(m[1])), "tmdb"],
  [/^movie\/(\d+)$/,           (ctx, m) => movieView(ctx, Number(m[1])),          "tmdb"],
  [/^person\/(\d+)$/,          (ctx, m) => personView(ctx, Number(m[1])),         "tmdb"],
  [/^lists$/,                  (ctx)    => listsView(ctx),                         "db"],
  [/^list\/([0-9a-f-]{36})$/,  (ctx, m) => listView(ctx, m[1]),                    "db"],
];
```

Each entry has three parts: **pattern**, **view function**, and **what config it needs**.
In TypeScript the table has a type, `[RegExp, View, Needs][]`, where
`View = (ctx: ViewContext, match: RegExpMatchArray) => Promise<void>` and
`Needs = "tmdb" | "db"`. A typo like `"tmbd"` is now a compile error.

| URL | `rawPath` (hash minus `#/`) | Matches | View called |
|---|---|---|---|
| `…/#/` | `""` | `/^$/` | `homeView(ctx)` |
| `…/#/search/star%20wars` | `"search/star%20wars"` | search | `searchView(ctx, "star wars")` |
| `…/#/movie/27205` | `"movie/27205"` | movie | `movieView(ctx, 27205)` |
| `…/#/person/6193` | `"person/6193"` | person | `personView(ctx, 6193)` |
| `…/#/lists` | `"lists"` | lists | `listsView(ctx)` |
| `…/#/list/3f2a…c9` (36-char UUID) | `"list/3f2a…"` | list | `listView(ctx, "3f2a…")` |
| `…/#/nonsense` | `"nonsense"` | nothing | "Page not found" notice |

If a route needs `"tmdb"` and the TMDB key is still a placeholder, the router shows a setup
notice instead of calling the view. Same for `"db"` and Supabase.

#### 2. Render tokens: the "stale response" guard

**The problem.** You type "the", pause, then keep typing "the godfather". Two searches
go out. If the "the" response happens to arrive *last*, it would overwrite the correct
results.

**The fix.** Every call to `render()` bumps a counter and remembers its own number:

```js
let renderToken = 0;

async function render() {
  const token = ++renderToken;          // this render is #N
  const ctx = {
    current: () => token === renderToken,   // am I still the newest?
    show(html) {
      if (token !== renderToken) return false;  // a newer render started — do nothing
      app.innerHTML = html;
      return true;
    },
  };
  …
}
```

Views only ever write to the page through `ctx.show()`, and they check `ctx.current()`
after any later `await`. Timeline example:

```
time →
render #1  "the"           ───── fetch ──────────────────────── response arrives
render #2  "the godfather"     ── fetch ──── response arrives      │
                                                  │                 │
                                  show() → token 2 === 2 ✅ drawn   │
                                                     show() → 1 !== 2 ❌ ignored
```

The same guard covers clicking between movies quickly, or pressing Back while a page loads.

The `ctx` object handed to every view:

| Property | What it is |
|---|---|
| `ctx.el` | The `<main id="app">` element |
| `ctx.show(html)` | Replace the page, only if still current. Returns `true`/`false` so views can skip attaching event listeners to HTML that was never shown |
| `ctx.current()` | `true` if no newer render has started |
| `ctx.rerender()` | Re-run the current route without scrolling to the top (used after creating a list) |

#### 3. Header search

```js
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);   // wait for a 350ms pause in typing
});
```

- **Typing** searches after you pause for 350ms. That's a *debounce*: each keystroke
  cancels the previous timer, so "godfather" makes one request, not nine.
- **Enter** searches right away and calls `searchInput.blur()` to close the phone keyboard.
- **Refining a search** (you're already on a search page) uses `history.replaceState`
  instead of adding a new history entry, so Back takes you to where you were *before*
  searching, not through every half-typed word. Because `replaceState` doesn't fire
  `hashchange`, it calls `render()` itself.

```
Without replaceState:  Home → "the" → "the g" → "the godf" → "the godfather"   (Back ×4)
With replaceState:     Home → "the godfather"                                  (Back ×1)
```

#### Back button for the iPhone Home Screen app

Launched from the Home Screen, iOS shows no browser toolbar and has no swipe-back, so
without help, every movie page would be a dead end. `app.ts` numbers each history entry
in `history.state`:

```js
function trackHistory() {
  const idx = history.state?.idx;
  if (typeof idx === "number") historyIndex = idx;          // back/forward/reload
  else { historyIndex += 1; history.replaceState({ idx: historyIndex }, ""); } // new page
}
```

```
Home (idx 0) → Inception (idx 1) → Leonardo DiCaprio (idx 2)
  ‹ Back → Inception (idx 1)   ‹ Back → Home (idx 0, button hides)
```

Clicking ‹ Back calls `history.back()` when `idx > 0`. If the app opened straight onto a
movie page (`idx 0`), there's nothing in-app to go back to, so it goes **home** instead of
closing the app. The button only shows when `isStandalone` is true and you're not on
the home page. Desktop and iPhone Safari have their own Back buttons, so it stays hidden
there.

`runSearch()` passes `history.state` into its `replaceState` so refining a search keeps
the entry's number.

#### 4. Startup

```js
window.addEventListener("hashchange", () => render());
await initAuth(() => render({ keepScroll: true }));   // restore session first…
render();                                              // …then draw the first page
```

Auth is restored *before* the first render so the lists page doesn't flash "Sign in"
for a moment when you're actually signed in. When you sign in or out later, the current
page re-renders in place.

There's also one click listener on `#app` for any `[data-action=retry]` button, so every
error notice's "Try again" button works without extra wiring.

---

### `src/tmdb.ts` — talking to TMDB

Small, and only two exports matter.

#### `tmdb<T>(path, params)`

The `<T>` is the response shape the caller expects, from `types.ts`:

```ts
const data = await tmdb<Paged<Movie>>("/trending/movie/week");
data.results[0].title;       // ✅ TypeScript knows this is a string
data.results[0].tittle;      // ❌ compile error: typo caught before it ships
```

```js
const data = await tmdb("/search/movie", { query: "alien", page: 1 });
// → GET https://api.themoviedb.org/3/search/movie?api_key=…&query=alien&page=1
```

- **Supports both TMDB key types.** The short v3 "API Key" goes in the URL. The long v4
  "Read Access Token" is a JWT (always starts with `eyJ`) and goes in an
  `Authorization: Bearer …` header. The file checks which one you pasted.
- **Turns failures into readable messages** that the router shows on screen:

| What happened | Message shown |
|---|---|
| No internet / DNS failure | "Couldn't reach TMDB. Check your connection and try again." |
| 401 | "TMDB rejected the API key. Check TMDB_API_KEY in src/config.ts." |
| 404 | "TMDB doesn't have that page." |
| Anything else | "TMDB returned an error (503). Try again." |

#### `img(path, size)`

TMDB returns image *paths* like `/qJ2tW6WMUDux911r6m7haRef0WH.jpg`. This builds the
full URL:

```js
img("/qJ2tW6WMUDux911r6m7haRef0WH.jpg", "w342")
// → "https://image.tmdb.org/t/p/w342/qJ2tW6WMUDux911r6m7haRef0WH.jpg"
img(null)  // → null   (lets callers show a placeholder instead)
```

Sizes used: `w185` (cast faces, small thumbnails), `w342` (grid posters), `w500` (detail
poster), `w1280` (backdrop). Smaller sizes load faster on phones.

`tmdbConfigured` is `false` while the key is still `YOUR_…`.

---

### `src/db.ts` — every database query

Creates the Supabase client and wraps every query the app makes. Views never write
Supabase queries themselves. They call these functions.

#### The `run()` helper

Supabase doesn't throw errors. It returns `{ data, error }`. `run()` turns that into
normal JavaScript exceptions so views can use `try/catch`:

```ts
async function run<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  let result: { data: unknown; error: unknown };
  try { result = await query; }             // network failure → the promise rejects
  catch { throw new Error(UNAVAILABLE); }
  if (result.error) {                        // Supabase error → logged, then thrown
    console.error(result.error);
    throw new Error(UNAVAILABLE);
  }
  return result.data as T;
}
```

`<T>` makes `run` **generic**: the caller says what shape it expects back, e.g.
`run<List[]>(…)`. We don't give Supabase a full database schema type, so its results are
untyped until `run<T>` labels them with the interfaces from `types.ts`. If you change a
`select(…)`, update the `T` to match.

`supabase` is `SupabaseClient | null` (null while `config.ts` still has placeholders).
Query functions go through a small `client()` helper that returns the client or throws
"Lists are temporarily unavailable", so the rest of the code never has to check for
`null`.

Either way the user sees one friendly message: *"Lists are temporarily unavailable. Try
again in a moment."* The technical details go to the browser console for debugging.

#### The functions

| Function | Used by | SQL equivalent |
|---|---|---|
| `getLists()` | My Lists page | every list + a light snapshot of its films, newest list first |
| `getList(id)` | List page | one list + all its films, or `null` |
| `getListsForMovie(tmdbId)` | Add-to-list panel | every list + whether this film is in it |
| `createList(name)` | Lists page, panel | `insert into lists (name) … returning id, name` |
| `renameList(id, name)` | List page | `update lists set name = … where id = …` |
| `deleteList(id)` | List page | `delete from lists where id = …` (its films go too, see §7) |
| `addToList(listId, movie)` | Panel | insert, ignoring duplicates |
| `removeFromList(listId, tmdbId)` | Panel, List page | `delete from list_items where …` |

Notice that **no function passes `user_id`**. The database fills it in from the signed-in
session and the security rules filter by it. The browser can't claim to be someone else.

#### Breakdown: `getListsForMovie` — one query instead of two

The Add-to-list panel needs *all* your lists, plus a tick next to the ones already
containing this film. The code:

```js
supabase
  .from("lists")
  .select("id, name, list_items(tmdb_id)")   // embed each list's items…
  .eq("list_items.tmdb_id", tmdbId)          // …but only items for THIS film
```

The filter applies to the **embedded** items, not to the lists. So every list comes back,
and `list_items` is either `[]` (film not in it) or `[{ tmdb_id: 27205 }]` (film is in it):

```js
// Raw response for Inception (27205):
[
  { id: "a1…", name: "Nolan marathon", list_items: [{ tmdb_id: 27205 }] },
  { id: "b2…", name: "Date night",     list_items: [] },
]
// After the .map():
[
  { id: "a1…", name: "Nolan marathon", contains: true  },   // ☑ ticked
  { id: "b2…", name: "Date night",     contains: false },   // ☐
]
```

#### Breakdown: `addToList` — safe to call twice

```js
supabase.from("list_items").upsert(
  { list_id, tmdb_id: movie.id, title: movie.title, poster_path, release_date },
  { onConflict: "list_id,tmdb_id", ignoreDuplicates: true },
);
```

The table's primary key is `(list_id, tmdb_id)`, so a film can only be in a list once.
`ignoreDuplicates: true` means adding a film that's already there does nothing instead of
erroring. That matters if you have the same movie open on your phone and computer and
tick the box on both.

It stores a **snapshot** (title, poster, date) so the list page can show posters without
making one TMDB request per film.

`getLists()` and `getList()` both sort items by `added_at` in JavaScript, because
PostgREST can't easily order embedded rows. This keeps lists in "order added".

---

### `src/auth.ts` — sign-in and the header avatar

#### Exports

| Export | What it does |
|---|---|
| `currentUser()` | The signed-in user object, or `null`. Views call this to decide what to show |
| `openSignIn()` | Clears the form and opens the sign-in dialog |
| `initAuth(onChange)` | Restores a saved session, draws the header, and calls `onChange` whenever the user changes |

#### How staying signed in works

Supabase stores your session in the browser's `localStorage` and refreshes the token
automatically. Each device (and each browser, and iOS home-screen apps) has its own
storage, so **you sign in once per device** and then stay signed in until you press
Sign out.

```
initAuth()
  ├─ supabase.auth.getSession()   → reads localStorage, e.g. { user: { email: "you@…" } }
  ├─ renderSlot()                 → header shows  [Y] [Sign out]
  └─ onAuthStateChange(…)         → listens for future sign-in / sign-out / token refresh
```

#### The header slot has three states

| Situation | Header shows |
|---|---|
| Supabase not configured | nothing |
| Signed out | gold **Sign in** button |
| Signed in | gold circle with your email's first letter + **Sign out** |

**Signing out only affects this device.** `signOut({ scope: "local" })` ends the
session on the device you tapped it on. Supabase's default (`"global"`) would also sign
out your phone when you sign out on your computer.

#### Two subtle details

```js
supabase.auth.onAuthStateChange((_event, session) => {
  const next = session?.user ?? null;
  if (next?.id === user?.id) return;   // ① ignore token refreshes (same user)
  user = next;
  renderSlot();
  setTimeout(onChange, 0);             // ② don't call Supabase inside this callback
});
```

1. Supabase fires this event for token refreshes too (about hourly). Without the check,
   the page would re-render out of nowhere while you're reading it.
2. Supabase's docs warn that awaiting another Supabase call *inside* this callback can
   deadlock. `setTimeout(…, 0)` runs the re-render just after the callback finishes.

There's **no sign-up form** on purpose. It's a single-user site: you create your one
account in the Supabase dashboard, then turn off sign-ups.

Error messages are friendlier than Supabase's defaults: "Invalid login credentials"
becomes "Wrong email or password."

---

### `src/ui.ts` — shared HTML helpers

Small functions used by every view.

| Export | Example | Result |
|---|---|---|
| `esc(value)` | `esc('<b>"Hi"</b>')` | `&lt;b&gt;&quot;Hi&quot;&lt;/b&gt;` |
| `year(date)` | `year("2010-07-15")` | `"2010"` |
| `formatDate(date)` | `formatDate("2010-07-16T00:00:00.000Z")` | `"July 16, 2010"` (in your locale) |
| `posterImg(path, title, size)` | `posterImg(null, "Untitled")` | `<div class="noposter">Untitled</div>` |
| `posterCard(movie, { removable })` | see below | clickable framed poster |
| `loadingHTML(inline)` | `loadingHTML()` | spinning dotted-brass circle |
| `noticeHTML(title, body, button)` | `noticeHTML("List not found")` | centred message box |
| `toast(message)` | `toast("Added to “Date night”")` | pop-up at the bottom for 2.6s |
| `byId<T>(id)` | `byId<HTMLInputElement>("search-input")` | the element, typed; throws if `index.html` lost it |
| `find<T>(root, selector)` | `find<HTMLButtonElement>(ctx.el, "#spin")` | same, inside something a view just drew |
| `errorMessage(err)` | `errorMessage(new Error("Oops"))` | `"Oops"` (and `String(err)` for anything else thrown) |

The last three exist for TypeScript's `strict` mode (see §3b). `document.getElementById`
might return `null`, so the compiler won't let you use the result directly. `byId` and
`find` check once and fail with a clear message instead.

#### Why `esc()` matters

Views build HTML with template strings. Any text from outside (movie titles, list names,
bios) goes through `esc()` first. Without it, a list named
`<img src=x onerror=alert(1)>` would *run code* when displayed. With it, the text shows
literally.

#### `posterCard` works with two data shapes

TMDB movies have `id`. Saved list items have `tmdb_id`. The card accepts either:

```js
const id = movie.tmdb_id ?? movie.id;
```

```js
posterCard({ id: 27205, title: "Inception", poster_path: "/9gk…jpg", release_date: "2010-07-15" })
```
```html
<a class="card" href="#/movie/27205" data-id="27205">
  <div class="poster"><img src="https://image.tmdb.org/t/p/w342/9gk…jpg" alt="Inception" loading="lazy"></div>
  <div class="card-meta">
    <span class="card-title">Inception</span>
    <span class="card-year">2010</span>
  </div>
</a>
```

With `{ removable: true }` (list page) it adds a ✕ button in the corner.
`loading="lazy"` means posters far down the page only download when you scroll near
them. That's a big saving on a 200-film filmography.

`formatDate` appends `T00:00:00` to plain dates so `"2010-07-16"` isn't read as UTC
midnight. Otherwise it would show as July 15 in American timezones.

---

### `src/ios.ts` — iPhone detection and the Home Screen tip

| Export | What it is |
|---|---|
| `isIOS` | `true` on iPhone/iPad. iPadOS pretends to be a Mac, so it also checks "Mac with a touch screen" |
| `isStandalone` | `true` when launched from the Home Screen icon (`navigator.standalone` on iOS, `display-mode: standalone` elsewhere) |
| `homeScreenTipHTML()` | The "Add Reel Log to your Home Screen" box, or `""` if not iPhone Safari or already dismissed |
| `bindHomeScreenTip(root)` | Wires the ✕ to hide the tip and remember that in `localStorage` |

**Why the tip exists.** Safari deletes a website's saved data, including your Supabase
sign-in, if you don't open the site for about a week. Home Screen apps are exempt from
that cleanup. So in Safari (not the app, not desktop) the lists page suggests adding it:

| Device | Tip shown? |
|---|---|
| Computer (any browser) | no |
| iPhone, Home Screen app | no, already there |
| iPhone, Safari | **yes**, until you tap ✕ |

`localStorage` is wrapped in `try/catch` because older iOS versions threw errors in
Private Browsing. There the tip simply comes back next visit.

It also adds one empty `touchstart` listener to the page. iOS Safari ignores CSS
`:active` (the press feedback) unless the page listens for touches, and an empty passive
listener is enough.

---

## 5. Views

Every view is an `async function xxxView(ctx, …)` that fetches data and then calls
`ctx.show(html)`. If it throws, the router catches it and shows the error with a
"Try again" button, so views don't need their own error pages for the main fetch.

### `src/views/home.ts` — "Now Showing"

The simplest view. It fetches `/trending/movie/week` (20 films) and renders them as a
poster wall. It's a good template to copy when adding a new page.

### `src/views/search.ts` — search results

```
#/search/alien
  └─ tmdb("/search/movie", { query: "alien", page: 1, include_adult: "false" })
       ├─ 0 results → "No films match “alien”"
       └─ results   → "54 results for “alien”" + grid + [Load more]
```

**Load more** fetches the next page and appends it. Two details:

- **Duplicate guard.** TMDB pages can overlap when results shift between requests, so a
  `Set` of IDs already shown filters repeats:
  ```js
  .filter((m) => !shown.has(m.id) && shown.add(m.id))
  // shown.add() returns the Set (truthy), so this reads: "if not seen, mark seen and keep"
  ```
- **Stale guard.** After awaiting page 2, it checks `ctx.current()`. If you've already
  navigated away, it doesn't try to append to a page that's gone.

The button disappears once `page === total_pages`.

### `src/views/movie.ts` — movie detail + Add to list

The biggest view. It makes **one** TMDB request that gets the movie, cast and release
dates together:

```js
tmdb(`/movie/${id}`, { append_to_response: "credits,release_dates" })
```

#### What's on the page

```
┌──────────────── backdrop (sepia-tinted, fades into the wall) ───────────────┐
│                                                                             │
│ ┌──────┐  Inception 2010                                                    │
│ │poster│  Directed by Christopher Nolan         ← links to person page      │
│ │      │  [PG-13] [2h 28m] [Action] [Science Fiction]                       │
│ │      │  [ ＋ ADD TO LIST ]                     ← opens panel              │
│ └──────┘  YOUR MIND IS THE SCENE OF THE CRIME.   ← tagline                  │
│           Overview paragraph…                                               │
│           RELEASE DATES · US ─────────                                      │
│           Premiere    July 8, 2010 · Los Angeles                            │
│           Theatrical  July 16, 2010                                         │
│           CAST ─────────                                                    │
│           (●) (●) (●) (●) (●)  ← top 20, each links to person page          │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Breakdown: `releaseRows(movie)`

TMDB's `release_dates` has every country. We pick the US and turn the numeric `type`
into words:

```js
const RELEASE_TYPES = { 1: "Premiere", 2: "Theatrical (limited)", 3: "Theatrical",
                        4: "Digital", 5: "Physical", 6: "TV" };
```

Example input (trimmed):

```json
{ "results": [
  { "iso_3166_1": "GB", "release_dates": [ … ] },
  { "iso_3166_1": "US", "release_dates": [
      { "type": 3, "release_date": "2010-07-16T00:00:00.000Z", "certification": "PG-13" },
      { "type": 1, "release_date": "2010-07-08T00:00:00.000Z", "certification": "PG-13", "note": "Los Angeles" },
      { "type": 5, "release_date": "2010-12-07T00:00:00.000Z", "certification": "" }
  ]}
]}
```

Output: sorted by date, with the note appended:

| Type | Date |
|---|---|
| Premiere | July 8, 2010 · Los Angeles |
| Theatrical | July 16, 2010 |
| Physical | December 7, 2010 |

**Fallback:** many non-US films have no US entry. Then it shows a single "Released" row
using the movie's main `release_date`, and the heading drops the "· US".

`certification()` finds the first US entry with a non-empty certification (e.g. `PG-13`),
shown as the gold chip.

`runtime(148)` → `"2h 28m"`; `runtime(45)` → `"45m"`.

#### Breakdown: the Add-to-list panel (`setupListPanel`)

```
click [＋ ADD TO LIST]
  ├─ signed out? → open sign-in dialog, stop
  └─ toggle panel open → fill()
        ├─ getListsForMovie(27205)
        └─ draw:  ☑ Nolan marathon
                  ☐ Date night
                  [New list name        ] [CREATE]
```

- **Ticking a box** calls `addToList`, and unticking calls `removeFromList`. The box is
  disabled while saving so you can't double-click. **If saving fails, the tick is undone**
  (`box.checked = !box.checked`) and a toast explains, so the checkbox never lies about
  what's saved.
- **Create** makes the list, adds this film to it, and redraws the panel with the new list
  already ticked.

### `src/views/person.ts` — actor / director page

```js
tmdb(`/person/${id}`, { append_to_response: "movie_credits" })
```

Shows photo, name, department ("Acting"), birth/death info, bio, and every film.

#### Breakdown: `filmography(person)`

1. **Combine** acting credits with films they *directed*, so Greta Gerwig's page shows
   *Barbie* as well as her acting roles.
2. **De-duplicate.** Clint Eastwood both acted in and directed *Gran Torino*. It should
   appear once.
3. **Sort** newest first, with undated (usually unannounced/upcoming) films at the end:

```js
.sort((a, b) => {
  if (!a.release_date || !b.release_date)
    return a.release_date ? -1 : b.release_date ? 1 : 0;   // undated → end
  return b.release_date.localeCompare(a.release_date);     // newest first
});
```

```
Input:   [2008 "Gran Torino"(cast), 1992 "Unforgiven", "" "Untitled Project", 2008 "Gran Torino"(crew)]
Deduped: [2008 "Gran Torino", 1992 "Unforgiven", "" "Untitled Project"]
Sorted:  [2008 "Gran Torino", 1992 "Unforgiven", "" "Untitled Project"]
```

**Read more:** the bio is clamped to 6 lines. After rendering, the code compares
`scrollHeight` with `clientHeight`. The "Read more" button only appears if text is
actually cut off, so short bios don't get a useless button.

### `src/views/lists.ts` — My Lists

- **Signed out:** a notice with a Sign in button.
- **Signed in:** a "New list name" form, then a grid of list cards.

Each card shows the list's first 4 posters as a fanned stack, its name, and a count
("1 film" / "3 films", with proper singular/plural). After creating a list, it calls
`ctx.rerender()` to redraw in place without jumping to the top of the page.

**Randomize on every card.** Each card has a 🎡 Randomize button (disabled under 2
films) that opens the same wheel as the list page, so you can pick a movie without
opening the list. The button sits **beside** the card's link, not inside it:

```html
<div class="list-card">
  <a href="#/list/…"> posters · name · count </a>
  <button data-spin="…">🎡 Randomize</button>
</div>
```

A button inside a link is invalid HTML. On iPhone the tap can also reach the link and
open the list, so keeping them siblings avoids both problems. One click listener on the
grid finds the list by `data-spin` and calls `openWheel(list.list_items)`. `getLists()`
also fetches `release_date` so the wheel's result card can show the year.

On iPhone Safari, the Home Screen tip from `ios.ts` appears at the top of this page.

### `src/views/list.ts` — one list

```
┌──────────────────────────────────────────────────────────────┐
│ Date night                 [🎡 RANDOMIZE] [RENAME] [DELETE]   │
│ 7 films                                                      │
│ ┌────┐✕ ┌────┐✕ ┌────┐✕ …                                    │
│ │    │  │    │  │    │                                       │
└──────────────────────────────────────────────────────────────┘
```

| Action | What happens |
|---|---|
| **Randomize** | Opens the wheel (§6) with this list's films. Disabled with fewer than 2 films |
| **Rename** | Browser prompt → `renameList` → updates the heading in place (capped at 100 characters to match the database rule) |
| **Delete** | Confirm → `deleteList` → back to My Lists. The database deletes its films automatically |
| **✕ on a poster** | `removeFromList` → removes that card, updates the count, re-checks whether the wheel still has 2+ films |

**The ✕ button sits inside the poster's link**, so clicking it would normally open the
movie. One click listener on the whole grid (*event delegation*) catches ✕ clicks and
calls `e.preventDefault()` to stop the navigation:

```js
grid.addEventListener("click", (e) => {
  const button = e.target.closest("[data-remove]");
  if (!button) return;        // a normal poster click → let the link work
  e.preventDefault();         // a ✕ click → don't follow the link
  …
});
```

A visit to a deleted list's URL (or someone else's list ID) shows "List not found".
Security rules make other people's lists invisible, which looks the same as "doesn't exist".

---

## 6. The wheel — `src/wheel.ts`

The "Randomize" feature, on every list page and every My Lists card. Exports one function: `openWheel(items)`.

### What you see

```
        ┌────────────────────────────┐
        │  ⁘⁘ Tonight's Feature ⁘⁘   │  ← marquee sign, dotted border blinks like bulbs
        │            ▼               │  ← fixed pointer at 12 o'clock
        │       ╱ red │ gold ╲       │
        │     plum ───●─── cream     │  ← SVG wheel, one slice per film
        │       ╲ gold│ red  ╱       │
        │      [SPIN THE WHEEL]      │
        │  ┌──┐ NOW SHOWING          │  ← appears when the wheel stops
        │  │▓▓│ Inception 2010       │
        │  └──┘ [SEE DETAILS]        │
        └────────────────────────────┘
```

### How it works, step by step

**1. Pick the winner first, fairly.** The animation is just for show. The result is
decided before the wheel moves:

```js
const winner = items[Math.floor(Math.random() * items.length)];
```

Every film in the list has exactly the same chance, even in a 200-film list.

**2. Decide what's on the wheel.** More than 20 slices makes the labels unreadable. So:

- **≤ 20 films:** all of them, in list order, drawn once.
- **> 20 films:** each spin draws a fresh wheel of the winner + 19 random others,
  shuffled. The winner is always on the wheel, and every film still had an equal chance.

`shuffle()` is a Fisher–Yates shuffle, the standard unbiased way to shuffle an array.

**3. Draw the slices** (`wheelSVG`). Angles are measured **clockwise from 12 o'clock**
(where the pointer is). With `n` films, each slice is `step = 360 / n` degrees, and slice
`i` covers `i·step` to `(i+1)·step`.

`xy(deg, r)` converts an angle into SVG coordinates:

```js
x =  r · sin(deg)       // 0° → x=0 (top centre), 90° → x=r (right)
y = −r · cos(deg)       // SVG's y axis points DOWN, hence the minus
```

| Angle | Point (r = 100) | Where |
|---|---|---|
| 0° | (0, −100) | top |
| 90° | (100, 0) | right |
| 180° | (0, 100) | bottom |
| 270° | (−100, 0) | left |

Each slice is an SVG path: *move to centre → line to the start edge → arc to the end
edge → close*:

```
M0 0  L0.00 -100.00  A100 100 0 0 1 58.78 -80.90  Z      (slice 0 of 10: 0° → 36°)
```

Labels are rotated to the middle of their slice and right-aligned near the rim, so they
read outward from the centre.

**Colours** cycle red → gold → plum → cream. Because the wheel is a circle, the last
slice touches the first. If they'd get the same colour (when `n − 1` is a multiple of 4,
e.g. 5 or 9 films), the last slice switches to gold:

```js
const colorFor = (i, n) =>
  (i === n - 1 && i % COLORS.length === 0 ? COLORS[1] : COLORS[i % COLORS.length]);
// n = 5:  red, gold, plum, cream, [red→gold]   ← no red-next-to-red at 12 o'clock
```

Font size shrinks as slices get thinner (7.5 → 6.2 → 5), and long titles are cut with "…".

**4. Work out how far to spin.** This is the tricky part.

If the wheel is rotated clockwise by `R` degrees, the slice under the pointer is the one
at angle `(360 − R mod 360)`. We want the pointer inside the winner's slice, at a random
spot between 15% and 85% across it (so it doesn't always stop dead centre, and never on a
line):

```js
const target = index * step + step * (0.15 + Math.random() * 0.7);
rotation = rotation - (rotation % 360) + 360 * 6 + (360 - target);
//         └──── back to a full turn ───┘  └ 6 laps ┘ └ land on target ┘
```

**Worked example:** 10 films (`step = 36°`), winner is slice 3 (covers 108°–144°),
random factor 0.5.

```
target   = 3·36 + 36·(0.15 + 0.5·0.7) = 108 + 18 = 126°
First spin (rotation = 0):
rotation = 0 − 0 + 2160 + (360 − 126) = 2394°
Check:   2394 mod 360 = 234  →  360 − 234 = 126°  ✅ inside 108°–144°

Second spin, new winner slice 7 (252°–288°), target 270°:
rotation = 2394 − 234 + 2160 + (360 − 270) = 4410°
Check:   4410 mod 360 = 90   →  360 − 90 = 270°   ✅ inside 252°–288°
```

The rotation always *increases*, so the wheel keeps turning clockwise instead of snapping
backwards, and always does at least 6 laps.

**5. Animate with CSS**, not JavaScript:

```css
.wheel-rotor.spinning { transition: transform 5.2s cubic-bezier(.12, .7, .08, 1); }
```

The code sets `style.transform = "rotate(2394deg)"` and the browser animates it. The
cubic-bezier curve starts fast and slows gradually, like a real wheel losing speed.
The rotation is applied to an HTML `<div>` wrapping the SVG (not to something inside
the SVG), because browsers agree on where a div's centre is.

**6. Show the result, even if the tab was hidden.** The result appears on `transitionend`.
**But** browsers pause animations in background tabs, so if you switch apps mid-spin that
event may never fire and the button would stay stuck. So there's a backup timer:

```js
let finished = false;
const fallback = setTimeout(done, 5600);                           // backup
rotor.addEventListener("transitionend", done, { once: true });    // normal path

function done() {
  if (finished) return;      // whichever fires second is ignored
  finished = true;
  clearTimeout(fallback);
  … show winner card, re-enable button as "Spin again" …
}
```

(This was a real bug found during testing and fixed.)

**7. Clean up.** The dialog is created fresh each time and removed from the page when it
closes. Clicking "See details" closes it and navigates to the movie.

---

## 7. Backend & automation

### `supabase/schema.sql` — the database

Run once in the Supabase SQL editor. It's safe to re-run: it uses `if not exists` and
`drop policy if exists`.

#### Tables

```
lists                                   list_items
┌──────────────┬─────────────┐          ┌──────────────┬──────────────┐
│ id           │ uuid  PK    │◄─────────│ list_id      │ uuid  PK, FK │
│ user_id      │ uuid  → you │   1 : N  │ tmdb_id      │ int   PK     │
│ name         │ text 1–100  │          │ title        │ text         │
│ created_at   │ timestamptz │          │ poster_path  │ text  (null) │
└──────────────┴─────────────┘          │ release_date │ date  (null) │
                                        │ added_at     │ timestamptz  │
                                        └──────────────┴──────────────┘
```

| Rule | Why |
|---|---|
| `user_id … default auth.uid()` | The database fills in *who you are* from your login. The browser never sends it, so it can't fake it |
| `check (length(name) between 1 and 100)` | No empty or giant list names, even if someone bypasses the UI |
| `primary key (list_id, tmdb_id)` | A film can only be in a given list once |
| `references lists on delete cascade` | Deleting a list automatically deletes its films |
| `references auth.users on delete cascade` | Deleting your account deletes your lists |
| index on `lists(user_id)` | Keeps "find my lists" fast |

#### Row-level security (RLS): the part that keeps your data private

Remember, the key in `src/config.ts` is public. Anyone could send queries with it. RLS
makes Postgres check **every row** against a rule before returning or changing it:

```sql
create policy "own lists" on lists for all to authenticated
  using      (user_id = (select auth.uid()))    -- can SEE/UPDATE/DELETE a row only if it's yours
  with check (user_id = (select auth.uid()));   -- can only INSERT/UPDATE rows that stay yours
```

`list_items` has no `user_id` of its own, so its rule asks "does the parent list belong
to you?":

```sql
using (exists (select 1 from lists l
               where l.id = list_items.list_id and l.user_id = (select auth.uid())))
```

**What that means in practice:**

| Who's asking | `select * from lists` returns |
|---|---|
| You, signed in | your lists |
| Someone with the anon key, not signed in | `[]`: the policy is `to authenticated`, so anonymous requests see nothing |
| Another signed-in user (if sign-ups were on) | only *their* lists, never yours |
| Someone trying to add a film to *your* list ID | rejected: the parent list isn't theirs |

`(select auth.uid())` in parentheses is a Supabase performance tip. Postgres computes it
once per query instead of once per row.

### `.github/workflows/keepalive.yml` — stop Supabase from sleeping

Free Supabase projects **pause after 7 days with no activity**. A personal site might go
unused for a week, and then your lists would be unreachable until you un-pause the project
in the dashboard.

This GitHub Action runs on a schedule and makes one tiny request:

```yaml
on:
  schedule:
    - cron: "0 12 */3 * *"     # 12:00 UTC on every 3rd day of the month
  workflow_dispatch:            # adds a "Run workflow" button for manual testing
```

```bash
curl … "$SUPABASE_URL/rest/v1/lists?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY"
```

- It uses the **anon key without signing in**, so thanks to RLS it gets back `[]`. It
  can't read your data, but the request still counts as activity.
- `test "$status" = "200"` makes the job fail (red ✕ in GitHub, plus an email) if
  Supabase stops answering, so you'd know.
- The URL and key come from **repo secrets**, not the file (setup in `README.md`).

Cron syntax cheat-sheet: `minute hour day-of-month month day-of-week`. `*/3` in the
day field means "every 3rd day".

---

## 8. Docs

| File | What's in it | Read it when… |
|---|---|---|
| `README.md` | Step-by-step setup: TMDB key, Supabase project, GitHub Pages, keep-alive secrets, phone tips, running locally | setting up, or setting up again from scratch |
| `CODE_GUIDE.md` | This file: *what* each file does, *how*, and *why* | you're reading or changing the code |
| `TYPESCRIPT_MIGRATION.md` | Record of the JavaScript → TypeScript switch: every file changed, why, and how it was tested | you want to know what the TypeScript switch changed, or need to undo it |

---

## 9. Walkthroughs: what happens when…

### …you search for a film on your phone

```
1. You type "dune"                      app.ts: input event → 350ms timer starts
2. You stop typing                       app.ts: runSearch() → location.hash = "#/search/dune"
3. hashchange fires                      app.ts: render() → token #7 → matches search route
4. Loading spinner shows                 ctx.show(loadingHTML())
5. searchView(ctx, "dune")               search.ts → tmdb("/search/movie", {query:"dune"})
6. TMDB responds                         ctx.show(grid) → token still #7 ✅ → posters appear
7. You tap "Dune: Part Two"              link → "#/movie/693134" → render() → token #8
```

### …you add a film to a list

```
1. Tap [＋ ADD TO LIST]                   movie.ts: currentUser()? yes → fill()
2. Panel loads                            db.ts: getListsForMovie(693134)
                                            → Supabase checks RLS → returns your 3 lists
3. Tick "Sci-fi"                           db.ts: addToList(listId, movie)
                                            → upsert into list_items (RLS: parent list is yours ✅)
4. Toast: Added to "Sci-fi"
5. Later, on your computer: open My Lists → getLists() → Sci-fi now shows 1 more poster
```

### …you spin the wheel

```
1. List page → [🎡 RANDOMIZE]             list.ts: openWheel(list.list_items)
2. Dialog opens, wheel drawn              wheel.ts: wheelSVG(films)
3. [SPIN THE WHEEL]                        winner chosen → rotation computed → CSS animates 5.2s
4. Wheel stops                             transitionend (or the 5.6s backup) → winner card
5. [SEE DETAILS]                           dialog closes → "#/movie/<id>"
```

### …something goes wrong

| Problem | What you see | Where it's handled |
|---|---|---|
| Keys not filled in | "Almost there — add a TMDB key" | `app.ts` `SETUP` notices |
| Wrong TMDB key | "TMDB rejected the API key…" + Try again | `tmdb.ts` → router catch |
| Offline | "Couldn't reach TMDB…" + Try again | `tmdb.ts` → router catch |
| Supabase paused/down | "Lists are temporarily unavailable…" | `db.ts` `run()` |
| Saving a tick fails | Tick undone + toast | `movie.ts` checkbox handler |
| Wrong password | "Wrong email or password." | `auth.ts` |
| Deleted/unknown list URL | "List not found" | `list.ts` |

---

## 10. How to extend it

**Add a new page** (e.g. "Upcoming"):
1. Create `src/views/upcoming.ts` by copying `home.ts`, and change the TMDB path to
   `/movie/upcoming`. It returns the same `Paged<Movie>` shape, so the types carry over.
2. In `app.ts`, import it and add `[/^upcoming$/, (ctx) => upcomingView(ctx), "tmdb"]`.
3. Link to `#/upcoming` from `index.html`'s nav.
4. With `npm run watch` running, check it at `localhost:8000`, then push.

**TMDB returns a field you want that isn't typed yet:** add it to the matching interface
in `types.ts` first (e.g. `vote_count: number` on `MovieDetails`). The compiler then
knows it exists everywhere.

**Show release dates for another country:** change `const COUNTRY = "US"` in
`movie.ts` (e.g. `"GB"`, `"CA"`).

**Re-theme:** edit the `:root` variables at the top of `styles.css`.

**Add a database column:** add it in `schema.sql` (and run an `alter table` in
Supabase), then include it in the relevant `select(…)` in `db.ts`.

**After any change:** edit in `src/`, check locally, then `git push`. GitHub type-checks,
builds and deploys. To make phones fetch the new version immediately, bump the `?v=`
number on both the CSS and JS links in `index.html`. That refreshes `styles.css` and
`js/app.js`. The other compiled modules (views, `db.js`, …) can stay cached for up to
~10 minutes on GitHub Pages. If a phone still looks stale, wait a few minutes or
force-reload.

---

## 11. iPhone vs computer: every difference and how it's handled

The goal is **no platform preference**: the same features and the same look on your
computer and your iPhone. Where iOS behaves differently, this is where the code covers it.

| Difference on iPhone | Handled by | What happens |
|---|---|---|
| Home Screen app has no Back button | `app.ts` history index + `#back-btn` | ‹ Back appears in the header, only in the app |
| Safari clears storage after ~7 days unvisited, signing you out | `ios.ts` tip | Suggests Add to Home Screen, where the data isn't cleared |
| Home Screen app and Safari keep separate storage | README | Sign in once in each. Expected, not a bug |
| Hover sticks after a tap | `@media (hover: hover)` wrappers | Hover effects only apply with a mouse |
| `:active` ignored without a touch listener | `ios.ts` `touchstart` listener | Press feedback works |
| `background-attachment: fixed` unsupported | `body::before` fixed layer | Lighting looks identical on both |
| `100vh` includes hidden toolbar area | `100dvh` | Footer sits at the real bottom |
| Inputs under 16px zoom the page | 16px inputs | No zoom when typing a search |
| Double-tap zoom delays taps | `touch-action: manipulation` | Instant buttons |
| Notch / home indicator | `env(safe-area-inset-*)` | Nothing hidden behind them |
| Page scrolls behind dialogs | `html:has(dialog[open])` | Dialog stays put |
| Animations pause in background apps | `wheel.ts` timer fallback | Wheel result always appears |
| Keyboard stays open after searching | `searchInput.blur()` on Enter | Keyboard closes |
| Home Screen icon and name | `apple-touch-icon`, manifest | Film-reel icon labelled "Reel Log" |

**Testing both:** desktop Chrome can check layout at phone width, but it can't reproduce
Safari's behaviour. Before relying on a change, open it on a real iPhone in both Safari
and the Home Screen app.

---

## 12. Design decisions and what they cost

Each choice below was deliberate. The "what it costs" column is what you'd gain by
choosing differently.

| Decision | Why | What it costs / when to revisit |
|---|---|---|
| **Just you, one account** | Personal site. You create your account in the Supabase dashboard and new sign-ups are turned off | Sharing lists with friends would need sign-ups back on plus a "public list" read rule |
| **No ratings anywhere** | Your choice. Neither your ratings nor TMDB's scores are shown | — |
| **Supabase** for sign-in + storage | Free Postgres with row-level security; works from a static site | Free projects pause after 7 idle days, hence `keepalive.yml` |
| **Email + password**, not Google or magic links | GitHub Pages sites live at `/<repo>/`, and Google sign-in / magic links need that exact URL registered as a redirect. A magic link also opens on whatever device got the email | One more password to remember. iCloud Keychain can save it on iPhone and Mac |
| **TypeScript compiled by `tsc`, no framework, no bundler** | Type safety with the smallest possible build: one `.ts` → one `.js`. GitHub Actions builds on push | Needs `npm install` and a build step (originally plain JS with none). Hand-written HTML strings. Past ~15 pages, React + Vite would pay off |
| **Hash routes** (`#/movie/27205`) | GitHub Pages can't route paths, so `/movie/27205` would 404 on refresh | Slightly uglier URLs |
| **Movie data straight from TMDB**, only a snapshot saved in lists | Always up to date, nothing to sync | A list shows the title/poster from when you added it (see §13) |
| **Sync on page load**, not live | Simple and reliable | A change on your phone shows on your computer after a reload. Supabase Realtime could push it live later |
| **Lists ordered by date added** | No reorder UI needed | Manual drag-to-reorder would need a `position` column |
| **US release dates and age ratings** | Your region | Change `COUNTRY` in `movie.ts` |
| **Wheel picks the winner first, then animates** | Guarantees every film has an equal chance, even in 200-film lists | The wheel shows at most 20 slices; bigger lists get a fresh random 20 each spin, always including the winner |
| **iPhone and computer equally**, no preference | You use both | Every change needs checking on both (§11) |

**Ideas for later** (none built yet): live sync between devices, drag-to-reorder lists,
a read-only share link for a list, filtering search by year or genre, and offline
poster caching.

---

## 13. Known limits and gotchas

Things that can bite after the code is written, and what to do about them.

1. **Turn off sign-ups.** If "Allow new users to sign up" stays on in Supabase, strangers
   could make accounts. Row-level security still keeps them out of your lists, but they'd
   use your free quota.
2. **Row-level security must be on.** A table created in the Supabase dashboard (instead
   of by `schema.sql`) may have it off, which makes the table public. Check **Advisors →
   Security Advisor** after setup.
3. **The keep-alive job can switch itself off.** GitHub disables scheduled workflows after
   60 days with no commits to the repo. You get an email; click to re-enable it, or
   Supabase will pause a week later.
4. **Supabase paused anyway?** The site shows "Lists are temporarily unavailable". Open
   the Supabase dashboard and click **Restore project**.
5. **TMDB key abused or revoked.** Generate a new key in TMDB settings and replace it in
   `src/config.ts`, then push. That's a single-line change.
6. **Stale version on your phone.** GitHub Pages caches for ~10 minutes. Bumping `?v=1`
   in `index.html` refreshes `styles.css` and `app.ts` immediately; the other JS files
   catch up within minutes.
7. **List snapshots don't update.** A list keeps the title and poster from when the film
   was added. If TMDB changes a poster later, the list shows the old one, while the movie
   page is always current.
8. **Missing release dates.** Many non-US films have no US dates. The movie page then
   shows just the main release date.
9. **Keep asset paths relative.** Write `styles.css`, never `/styles.css`. The site lives
   at `/<repo>/`, and absolute paths would point at the wrong folder.
10. **Separate sign-ins on iPhone.** The Home Screen app and Safari keep separate storage,
    so you sign in once in each. That's how iOS works, not a bug.
11. **Test on a real iPhone.** Desktop Chrome can mimic the screen size but not Safari's
    behaviour. Check changes in both Safari and the Home Screen app.
12. **Never put the Supabase `service_role` / secret key in `src/config.ts`.** It bypasses
    all security, and the file is public.
13. **Edit `src/`, never `js/`.** `js/` is regenerated on every build, and it isn't in git,
    so changes there vanish.
14. **"Build and deploy" failed on GitHub?** Open **Actions**, click the red run, and read
    the `Build` step. It lists the type errors with file and line. Fix locally with
    `npm run typecheck`, then push again. The live site stays on the previous version
    until then.
15. **Upgrading Supabase:** change the version in *both* `package.json` and the import map
    in `index.html`, then `npm install`.

---

## 14. Feature checklist

Everything the site does, and where it lives. Use this to confirm a change didn't break
anything, on both computer and iPhone.

| Feature | Where |
|---|---|
| Search by title, results as a poster wall, "Load more" | `search.ts`, header search in `app.ts` |
| Home page shows this week's trending films | `home.ts` |
| Movie page: backdrop, poster, director, age rating, runtime, genres, tagline, overview | `movie.ts` |
| US release dates by type (premiere, theatrical, digital…), with fallback | `movie.ts` `releaseRows()` |
| Top 20 cast with photos → actor pages with bio and filmography | `movie.ts`, `person.ts` |
| Add/remove a film from any list with checkboxes; create a list inline | `movie.ts` `setupListPanel()` |
| Create, rename, delete lists; remove films | `lists.ts`, `list.ts` |
| 🎡 Randomize wheel on each list page **and** each My Lists card | `wheel.ts`, `list.ts`, `lists.ts` |
| Sign in with email + password; same lists on phone and computer | `auth.ts`, `db.ts` |
| Only you can see or change your lists | `schema.sql` row-level security |
| Movie-theater poster-wall theme | `styles.css` |
| iPhone: Home Screen icon, Back button in the app, sign-in-loss tip, touch feedback | `ios.ts`, `app.ts`, `index.html`, `manifest.webmanifest`, `icons/` |
| Friendly messages for missing keys, errors, offline | `app.ts`, `tmdb.ts`, `db.ts` |
| Supabase kept awake | `.github/workflows/keepalive.yml` |
| TMDB attribution | footer in `index.html` |
