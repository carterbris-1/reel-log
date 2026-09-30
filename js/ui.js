import { img } from "./tmdb.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const year = (date) => (date ? date.slice(0, 4) : "");

export function formatDate(date) {
  if (!date) return "";
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function posterImg(path, title, size = "w342") {
  const src = img(path, size);
  return src
    ? `<div class="poster"><img src="${src}" alt="${esc(title)}" loading="lazy"></div>`
    : `<div class="noposter">${esc(title)}</div>`;
}

/** A clickable poster tile. Accepts TMDB movies ({id}) or list items ({tmdb_id}). */
export function posterCard(movie, { removable = false } = {}) {
  const id = movie.tmdb_id ?? movie.id;
  return `
    <a class="card" href="#/movie/${id}" data-id="${id}">
      ${posterImg(movie.poster_path, movie.title)}
      ${removable ? `<button class="card-remove" data-remove="${id}" aria-label="Remove ${esc(movie.title)}">✕</button>` : ""}
      <div class="card-meta">
        <span class="card-title">${esc(movie.title)}</span>
        <span class="card-year">${year(movie.release_date)}</span>
      </div>
    </a>`;
}

export const loadingHTML = (inline = false) =>
  `<div class="loading${inline ? " inline" : ""}"><div class="spinner"></div></div>`;

export function noticeHTML(title, body = "", button = "") {
  return `<div class="notice"><h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ""}${button}</div>`;
}

let toastTimer;
export function toast(message) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2600);
}
