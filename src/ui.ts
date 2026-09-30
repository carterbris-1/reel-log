import { img } from "./tmdb.js";
import type { ListItem, Movie } from "./types.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export const year = (date: string | null | undefined): string => (date ? date.slice(0, 4) : "");

export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** The readable message from anything thrown (catch variables are `unknown` in TS). */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** getElementById for elements index.html always has; fails loudly if one goes missing. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html is missing #${id}`);
  return el as T;
}

/** querySelector for elements a view has just rendered, so they must exist. */
export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
}

export function posterImg(path: string | null | undefined, title: string, size = "w342"): string {
  const src = img(path, size);
  return src
    ? `<div class="poster"><img src="${src}" alt="${esc(title)}" loading="lazy"></div>`
    : `<div class="noposter">${esc(title)}</div>`;
}

/** A clickable poster tile. Accepts TMDB movies ({id}) or list items ({tmdb_id}). */
export function posterCard(movie: Movie | ListItem, { removable = false } = {}): string {
  const id = "tmdb_id" in movie ? movie.tmdb_id : movie.id;
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

export const loadingHTML = (inline = false): string =>
  `<div class="loading${inline ? " inline" : ""}"><div class="spinner"></div></div>`;

export function noticeHTML(title: string, body = "", button = ""): string {
  return `<div class="notice"><h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ""}${button}</div>`;
}

let toastTimer: number | undefined;
export function toast(message: string): void {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2600);
}
