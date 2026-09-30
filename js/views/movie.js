import { tmdb, img } from "../tmdb.js";
import { getListsForMovie, createList, addToList, removeFromList } from "../db.js";
import { currentUser, openSignIn } from "../auth.js";
import { esc, year, formatDate, posterImg, loadingHTML, toast } from "../ui.js";

// TMDB release types: https://developer.themoviedb.org/reference/movie-release-dates
const RELEASE_TYPES = {
  1: "Premiere",
  2: "Theatrical (limited)",
  3: "Theatrical",
  4: "Digital",
  5: "Physical",
  6: "TV",
};
const COUNTRY = "US";

function releaseRows(movie) {
  const local = movie.release_dates?.results?.find((r) => r.iso_3166_1 === COUNTRY);
  const rows = (local?.release_dates ?? [])
    .slice()
    .sort((a, b) => a.release_date.localeCompare(b.release_date))
    .map((r) => [
      RELEASE_TYPES[r.type] ?? "Release",
      `${formatDate(r.release_date)}${r.note ? ` <span class="muted">· ${esc(r.note)}</span>` : ""}`,
    ]);
  // Many non-US films have no US dates; fall back to the primary release date.
  if (!rows.length && movie.release_date) rows.push(["Released", formatDate(movie.release_date)]);
  return rows;
}

function certification(movie) {
  const local = movie.release_dates?.results?.find((r) => r.iso_3166_1 === COUNTRY);
  return local?.release_dates?.find((r) => r.certification)?.certification ?? "";
}

function runtime(minutes) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

const personLinks = (people) =>
  people.map((p) => `<a href="#/person/${p.id}">${esc(p.name)}</a>`).join(", ");

function castCard(c) {
  const src = img(c.profile_path, "w185");
  return `
    <a class="cast" href="#/person/${c.id}">
      <div class="face">${src ? `<img src="${src}" alt="" loading="lazy">` : esc(c.name[0])}</div>
      <div class="name">${esc(c.name)}</div>
      ${c.character ? `<div class="role">${esc(c.character)}</div>` : ""}
    </a>`;
}

export async function movieView(ctx, id) {
  const m = await tmdb(`/movie/${id}`, { append_to_response: "credits,release_dates" });

  const directors = m.credits.crew.filter((c) => c.job === "Director");
  const cast = m.credits.cast.slice(0, 20);
  const cert = certification(m);
  const releases = releaseRows(m);
  const backdrop = img(m.backdrop_path, "w1280");

  const shown = ctx.show(`
    ${backdrop ? `<div class="backdrop" style="background-image:url('${backdrop}')"></div>` : ""}
    <div class="detail${backdrop ? "" : " flat"}">
      <div class="detail-poster">${posterImg(m.poster_path, m.title, "w500")}</div>
      <div class="detail-body">
        <div class="detail-head">
          <h1>${esc(m.title)}${m.release_date ? `<span class="year">${year(m.release_date)}</span>` : ""}</h1>
          ${directors.length ? `<div class="byline">Directed by ${personLinks(directors)}</div>` : ""}
          <div class="facts">
            ${cert ? `<span class="chip cert">${esc(cert)}</span>` : ""}
            ${m.runtime ? `<span class="chip">${runtime(m.runtime)}</span>` : ""}
            ${m.genres.map((g) => `<span class="chip">${esc(g.name)}</span>`).join("")}
          </div>
        </div>
        <div class="detail-rest">
          <div class="actions-row">
            <button class="btn btn-accent full" id="add-btn">＋ Add to list</button>
            <div class="list-panel" id="list-panel" hidden></div>
          </div>
          ${m.tagline ? `<p class="tagline">${esc(m.tagline)}</p>` : ""}
          ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ""}

          ${releases.length ? `
            <h2 class="section-title">Release dates${releases[0][0] === "Released" ? "" : ` · ${COUNTRY}`}</h2>
            <table class="release-table">
              ${releases.map(([type, date]) => `<tr><td>${type}</td><td>${date}</td></tr>`).join("")}
            </table>` : ""}

          ${cast.length ? `
            <h2 class="section-title">Cast</h2>
            <div class="cast-grid">${cast.map(castCard).join("")}</div>` : ""}
        </div>
      </div>
    </div>`);

  if (shown) setupListPanel(ctx, m);
}

function setupListPanel(ctx, movie) {
  const button = ctx.el.querySelector("#add-btn");
  const panel = ctx.el.querySelector("#list-panel");

  button.addEventListener("click", () => {
    if (!currentUser()) return openSignIn();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) fill();
  });

  async function fill() {
    panel.innerHTML = loadingHTML(true);
    let lists;
    try {
      lists = await getListsForMovie(movie.id);
    } catch (err) {
      panel.innerHTML = `<p class="error small">${esc(err.message)}</p>`;
      return;
    }
    if (!ctx.current()) return;

    panel.innerHTML = `
      ${lists.length
        ? lists.map((l) => `
            <label class="list-check">
              <input type="checkbox" data-list="${l.id}" ${l.contains ? "checked" : ""}>
              <span>${esc(l.name)}</span>
            </label>`).join("")
        : `<p class="muted small" style="margin:4px 6px">No lists yet — create your first one:</p>`}
      <form class="inline-form" id="new-list-form">
        <input name="name" placeholder="New list name" maxlength="100" required>
        <button class="btn btn-accent btn-sm">Create</button>
      </form>`;

    panel.querySelectorAll("input[type=checkbox]").forEach((box) => {
      box.addEventListener("change", async () => {
        const name = box.nextElementSibling.textContent;
        box.disabled = true;
        try {
          if (box.checked) {
            await addToList(box.dataset.list, movie);
            toast(`Added to “${name}”`);
          } else {
            await removeFromList(box.dataset.list, movie.id);
            toast(`Removed from “${name}”`);
          }
        } catch (err) {
          box.checked = !box.checked;
          toast(err.message);
        }
        box.disabled = false;
      });
    });

    panel.querySelector("#new-list-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const name = form.querySelector("input").value.trim();
      if (!name) return;
      form.querySelector("button").disabled = true;
      try {
        const list = await createList(name);
        await addToList(list.id, movie);
        toast(`Added to “${name}”`);
        if (ctx.current()) fill();
      } catch (err) {
        toast(err.message);
        form.querySelector("button").disabled = false;
      }
    });
  }
}
