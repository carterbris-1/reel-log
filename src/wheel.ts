import { esc, find, year, posterImg } from "./ui.js";
import type { ListItem } from "./types.js";

type Colors = readonly [fill: string, ink: string];

// Wheel segments cycle through the theater palette: velvet red, brass, plum, cream.
const COLORS: readonly Colors[] = [
  ["#b3202e", "#f6d27a"],
  ["#e2b04a", "#3a0a0f"],
  ["#4a1f33", "#f3e9dc"],
  ["#f3e0bf", "#5c0f17"],
];
const MAX_SEGMENTS = 20; // beyond this the labels become unreadable
const R = 100;

const xy = (deg: number, r = R): [string, string] => {
  const rad = (deg * Math.PI) / 180;
  return [(r * Math.sin(rad)).toFixed(2), (-r * Math.cos(rad)).toFixed(2)];
};
const point = (deg: number, r?: number) => xy(deg, r).join(" ");

// The last segment touches the first, so don't let them share a colour.
const colorFor = (i: number, n: number): Colors =>
  i === n - 1 && i % COLORS.length === 0 ? COLORS[1] : COLORS[i % COLORS.length];

const shuffle = <T>(arr: readonly T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Angles are measured clockwise from 12 o'clock, where the pointer sits.
 * Segment i covers [i·step, (i+1)·step).
 */
function wheelSVG(films: readonly ListItem[]): string {
  const n = films.length;
  const step = 360 / n;
  const fontSize = n <= 6 ? 7.5 : n <= 12 ? 6.2 : 5;
  const maxChars = n <= 6 ? 20 : 16;
  const segments = films.map((film, i) => {
    const [fill, ink] = colorFor(i, n);
    const start = i * step;
    const end = start + step;
    const label = film.title.length > maxChars ? `${film.title.slice(0, maxChars - 1)}…` : film.title;
    return `
      <path d="M0 0 L${point(start)} A${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${point(end)} Z"
            fill="${fill}" stroke="#0b0909" stroke-width="0.8"/>
      <text class="wheel-label" transform="rotate(${start + step / 2 - 90})" x="${R - 8}" y="0"
            text-anchor="end" dominant-baseline="central" font-size="${fontSize}" fill="${ink}">${esc(label)}</text>`;
  });
  // Bulbs around the rim, like a marquee.
  const bulbs = Array.from({ length: 24 }, (_, i) => {
    const [cx, cy] = xy(i * 15, R + 4);
    return `<circle cx="${cx}" cy="${cy}" r="1.8" fill="#fff3c4"/>`;
  }).join("");
  return `
    <svg class="wheel-svg" viewBox="-110 -110 220 220" aria-hidden="true">
      <circle r="${R + 8}" fill="#0b0909"/>
      <circle r="${R + 4}" fill="none" stroke="#e2b04a" stroke-width="1"/>
      ${bulbs}
      ${segments.join("")}
      <circle r="15" fill="#0b0909" stroke="#e2b04a" stroke-width="2"/>
      <circle r="5" fill="#e2b04a"/>
    </svg>`;
}

/** Opens the "Tonight's Feature" wheel for the given list items. */
export function openWheel(items: readonly ListItem[]): void {
  if (items.length === 0) return;

  const dialog = document.createElement("dialog");
  dialog.className = "wheel-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close-row"><button class="icon-btn" aria-label="Close">✕</button></form>
    <div class="marquee">Tonight’s Feature</div>
    <div class="wheel-wrap">
      <div class="wheel-pointer"></div>
      <div class="wheel-rotor"></div>
    </div>
    <div class="wheel-controls"><button class="btn btn-red" id="spin">Spin the wheel</button></div>
    <div id="wheel-result" aria-live="polite"></div>`;
  document.body.append(dialog);

  const rotor = find(dialog, ".wheel-rotor");
  const spinBtn = find<HTMLButtonElement>(dialog, "#spin");
  const result = find(dialog, "#wheel-result");
  let rotation = 0;
  let films = items.length > MAX_SEGMENTS ? shuffle(items).slice(0, MAX_SEGMENTS) : items;
  rotor.innerHTML = wheelSVG(films);

  spinBtn.addEventListener("click", () => {
    // Pick uniformly from the WHOLE list, then make sure the winner is on the wheel.
    const winner = items[Math.floor(Math.random() * items.length)];
    if (items.length > MAX_SEGMENTS) {
      const others = shuffle(items.filter((f) => f !== winner)).slice(0, MAX_SEGMENTS - 1);
      films = shuffle([winner, ...others]);
      rotor.innerHTML = wheelSVG(films);
    }
    const step = 360 / films.length;
    const index = films.indexOf(winner);
    // Land somewhere inside the winner's segment, not always dead centre.
    const target = index * step + step * (0.15 + Math.random() * 0.7);
    // Rotating the wheel clockwise by R puts angle (−R mod 360) under the pointer.
    rotation = rotation - (rotation % 360) + 360 * 6 + (360 - target);

    spinBtn.disabled = true;
    result.innerHTML = "";
    rotor.classList.add("spinning");
    rotor.style.transform = `rotate(${rotation}deg)`;

    // transitionend never fires if the tab is hidden mid-spin, so also finish on a timer.
    let finished = false;
    const fallback = setTimeout(done, 5600);
    rotor.addEventListener("transitionend", done, { once: true });

    function done(): void {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      spinBtn.disabled = false;
      spinBtn.textContent = "Spin again";
      result.innerHTML = `
        <div class="wheel-result">
          ${posterImg(winner.poster_path, winner.title, "w185")}
          <div>
            <div class="kicker">Now showing</div>
            <h3>${esc(winner.title)}${winner.release_date ? ` <span class="muted small">${year(winner.release_date)}</span>` : ""}</h3>
            <a class="btn btn-accent btn-sm" href="#/movie/${winner.tmdb_id}">See details</a>
          </div>
        </div>`;
    }
  });

  result.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
