import { tmdb } from "../tmdb.js";
import { esc, formatDate, posterImg, posterCard } from "../ui.js";
import type { Movie, PersonDetails, ViewContext } from "../types.js";

/** Acting credits plus films they directed, newest first, undated (upcoming) last. */
function filmography(person: PersonDetails): Movie[] {
  const credits: Movie[] = [
    ...person.movie_credits.cast,
    ...person.movie_credits.crew.filter((c) => c.job === "Director"),
  ];
  const seen = new Set<number>();
  return credits
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => {
      if (!a.release_date || !b.release_date) return a.release_date ? -1 : b.release_date ? 1 : 0;
      return b.release_date.localeCompare(a.release_date);
    });
}

export async function personView(ctx: ViewContext, id: number): Promise<void> {
  const p = await tmdb<PersonDetails>(`/person/${id}`, { append_to_response: "movie_credits" });
  const films = filmography(p);

  const facts = [
    p.known_for_department,
    p.birthday && `Born ${formatDate(p.birthday)}${p.place_of_birth ? ` in ${esc(p.place_of_birth)}` : ""}`,
    p.deathday && `Died ${formatDate(p.deathday)}`,
  ].filter((fact): fact is string => Boolean(fact));

  if (!ctx.show(`
    <div class="person-head">
      ${posterImg(p.profile_path, p.name, "w342")}
      <div>
        <h1>${esc(p.name)}</h1>
        ${facts.map((f) => `<div class="muted small">${f}</div>`).join("")}
        ${p.biography ? `
          <p class="bio clamped" id="bio">${esc(p.biography)}</p>
          <button class="link-btn small" id="bio-toggle" hidden>Read more</button>` : ""}
      </div>
    </div>
    <h2 class="section-title">Films · ${films.length}</h2>
    <div class="grid">${films.map((m) => posterCard(m)).join("")}</div>`)) return;

  const bio = ctx.el.querySelector<HTMLElement>("#bio");
  const toggle = ctx.el.querySelector<HTMLButtonElement>("#bio-toggle");
  if (bio && toggle && bio.scrollHeight > bio.clientHeight + 2) {
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const open = bio.classList.toggle("clamped") === false;
      toggle.textContent = open ? "Show less" : "Read more";
    });
  }
}
