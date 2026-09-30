import { tmdbConfigured } from "./tmdb.js";
import { dbConfigured } from "./db.js";
import { initAuth } from "./auth.js";
import { byId, errorMessage, esc, loadingHTML, noticeHTML } from "./ui.js";
import { isStandalone } from "./ios.js";
import { homeView } from "./views/home.js";
import { searchView } from "./views/search.js";
import { movieView } from "./views/movie.js";
import { personView } from "./views/person.js";
import { listsView } from "./views/lists.js";
import { listView } from "./views/list.js";
import type { ViewContext } from "./types.js";

const app = byId("app");
const searchInput = byId<HTMLInputElement>("search-input");
const navLists = byId("nav-lists");
const backBtn = byId<HTMLButtonElement>("back-btn");

type View = (ctx: ViewContext, match: RegExpMatchArray) => Promise<void>;
/** Which config a view can't run without. */
type Needs = "tmdb" | "db";

// [pattern, view, needs] — capture groups in the pattern arrive as match[1], match[2]…
const routes: [RegExp, View, Needs][] = [
  [/^$/, (ctx) => homeView(ctx), "tmdb"],
  [/^search\/(.+)$/, (ctx, m) => searchView(ctx, decodeURIComponent(m[1])), "tmdb"],
  [/^movie\/(\d+)$/, (ctx, m) => movieView(ctx, Number(m[1])), "tmdb"],
  [/^person\/(\d+)$/, (ctx, m) => personView(ctx, Number(m[1])), "tmdb"],
  [/^lists$/, (ctx) => listsView(ctx), "db"],
  [/^list\/([0-9a-f-]{36})$/, (ctx, m) => listView(ctx, m[1]), "db"],
];

const SETUP: Record<Needs, string> = {
  tmdb: noticeHTML(
    "Almost there — add a TMDB key",
    "Put your TMDB API key in <code>src/config.ts</code>, then run <code>npm run build</code>. See README.md.",
  ),
  db: noticeHTML(
    "Lists need Supabase",
    "Add your Supabase URL and key to <code>src/config.ts</code>, then run <code>npm run build</code>. See README.md.",
  ),
};

// ── Back button for iPhone Home Screen apps ──────────────────────────────────
// Launched from the Home Screen, iOS shows no browser toolbar and there's no swipe-back,
// so without our own button a movie page would be a dead end. Each history entry gets
// an index in history.state so we know whether "back" stays inside the app.
let historyIndex = -1;

function trackHistory(): void {
  const idx: unknown = history.state?.idx;
  if (typeof idx === "number") {
    historyIndex = idx; // back/forward/reload onto an entry we've already numbered
  } else {
    historyIndex += 1; // a brand-new entry
    history.replaceState({ idx: historyIndex }, "");
  }
}

backBtn.addEventListener("click", () => {
  if (historyIndex > 0) history.back();
  else location.hash = "#/"; // opened straight onto this page: go home instead of leaving
});

// Every render gets a token. Slow responses from a render that has since been
// replaced (fast typing, quick back/forward) check `current()` and bail out.
let renderToken = 0;

async function render({ keepScroll = false } = {}): Promise<void> {
  const token = ++renderToken;
  const rawPath = location.hash.replace(/^#\/?/, "");

  trackHistory();
  backBtn.hidden = !isStandalone || rawPath === "";
  navLists.classList.toggle("active", /^lists?(\/|$)/.test(rawPath));
  const searchMatch = rawPath.match(/^search\/(.+)$/);
  if (searchMatch && document.activeElement !== searchInput) {
    try {
      searchInput.value = decodeURIComponent(searchMatch[1]);
    } catch {
      // malformed %-escape in a hand-typed URL; the view reports it
    }
  }

  const ctx: ViewContext = {
    el: app,
    current: () => token === renderToken,
    show(html) {
      if (token !== renderToken) return false;
      app.innerHTML = html;
      return true;
    },
    rerender: () => render({ keepScroll: true }),
  };

  if (!keepScroll) window.scrollTo(0, 0);

  const route = routes.find(([pattern]) => pattern.test(rawPath));
  if (!route) {
    ctx.show(noticeHTML("Page not found", `<a class="link-btn" href="#/">Go home</a>`));
    return;
  }

  const [pattern, view, needs] = route;
  if (needs === "tmdb" && !tmdbConfigured) {
    ctx.show(SETUP.tmdb);
    return;
  }
  if (needs === "db" && !dbConfigured) {
    ctx.show(SETUP.db);
    return;
  }

  if (!keepScroll) ctx.show(loadingHTML());
  try {
    // The route was found with this same pattern, so match() can't be null here.
    await view(ctx, rawPath.match(pattern) as RegExpMatchArray);
  } catch (err) {
    console.error(err);
    ctx.show(
      noticeHTML(
        "Something went wrong",
        esc(errorMessage(err)),
        `<button class="btn" data-action="retry">Try again</button>`,
      ),
    );
  }
}

app.addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-action=retry]")) render();
});

// ── Header search: Enter searches now; typing searches after a pause ──────────
let searchTimer: number | undefined;

function runSearch(): void {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) return;
  const target = `#/search/${encodeURIComponent(q)}`;
  if (location.hash === target) return;
  if (location.hash.startsWith("#/search/")) {
    // Refining a search replaces the history entry instead of stacking one per pause.
    history.replaceState(history.state, "", target); // keep the history index
    render();
  } else {
    location.hash = target;
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
});

byId<HTMLFormElement>("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
  searchInput.blur(); // closes the phone keyboard
});

window.addEventListener("hashchange", () => render());

await initAuth(() => render({ keepScroll: true }));
render();
