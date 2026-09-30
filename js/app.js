import { tmdbConfigured } from "./tmdb.js";
import { dbConfigured } from "./db.js";
import { initAuth } from "./auth.js";
import { esc, loadingHTML, noticeHTML } from "./ui.js";
import { isStandalone } from "./ios.js";
import { homeView } from "./views/home.js";
import { searchView } from "./views/search.js";
import { movieView } from "./views/movie.js";
import { personView } from "./views/person.js";
import { listsView } from "./views/lists.js";
import { listView } from "./views/list.js";

const app = document.getElementById("app");
const searchInput = document.getElementById("search-input");
const navLists = document.getElementById("nav-lists");
const backBtn = document.getElementById("back-btn");

// [pattern, view, needs] — `needs` says which config the view can't run without.
const routes = [
  [/^$/, (ctx) => homeView(ctx), "tmdb"],
  [/^search\/(.+)$/, (ctx, m) => searchView(ctx, decodeURIComponent(m[1])), "tmdb"],
  [/^movie\/(\d+)$/, (ctx, m) => movieView(ctx, Number(m[1])), "tmdb"],
  [/^person\/(\d+)$/, (ctx, m) => personView(ctx, Number(m[1])), "tmdb"],
  [/^lists$/, (ctx) => listsView(ctx), "db"],
  [/^list\/([0-9a-f-]{36})$/, (ctx, m) => listView(ctx, m[1]), "db"],
];

const SETUP = {
  tmdb: noticeHTML(
    "Almost there — add a TMDB key",
    "Put your TMDB API key in <code>config.js</code> to search films. See README.md.",
  ),
  db: noticeHTML(
    "Lists need Supabase",
    "Add your Supabase URL and anon key to <code>config.js</code>. See README.md.",
  ),
};

// ── Back button for iPhone Home Screen apps ──────────────────────────────────
// Launched from the Home Screen, iOS shows no browser toolbar and there's no swipe-back,
// so without our own button a movie page would be a dead end. Each history entry gets
// an index in history.state so we know whether "back" stays inside the app.
let historyIndex = -1;

function trackHistory() {
  const idx = history.state?.idx;
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

async function render({ keepScroll = false } = {}) {
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

  const ctx = {
    el: app,
    current: () => token === renderToken,
    /** Replace the page content, unless a newer render has started. */
    show(html) {
      if (token !== renderToken) return false;
      app.innerHTML = html;
      return true;
    },
    rerender: () => render({ keepScroll: true }),
  };

  if (!keepScroll) window.scrollTo(0, 0);

  const route = routes.find(([pattern]) => pattern.test(rawPath));
  if (!route) return ctx.show(noticeHTML("Page not found", `<a class="link-btn" href="#/">Go home</a>`));

  const [pattern, view, needs] = route;
  if (needs === "tmdb" && !tmdbConfigured) return ctx.show(SETUP.tmdb);
  if (needs === "db" && !dbConfigured) return ctx.show(SETUP.db);

  if (!keepScroll) ctx.show(loadingHTML());
  try {
    await view(ctx, rawPath.match(pattern));
  } catch (err) {
    console.error(err);
    ctx.show(
      noticeHTML(
        "Something went wrong",
        esc(err.message),
        `<button class="btn" data-action="retry">Try again</button>`,
      ),
    );
  }
}

app.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=retry]")) render();
});

// ── Header search: Enter searches now; typing searches after a pause ──────────
let searchTimer;

function runSearch() {
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

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
  searchInput.blur(); // closes the phone keyboard
});

window.addEventListener("hashchange", () => render());

await initAuth(() => render({ keepScroll: true }));
render();
