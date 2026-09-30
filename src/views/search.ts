import { tmdb } from "../tmdb.js";
import { errorMessage, esc, find, loadingHTML, noticeHTML, posterCard, toast } from "../ui.js";
import type { Movie, Paged, ViewContext } from "../types.js";

const searchPage = (query: string, page: number) =>
  tmdb<Paged<Movie>>("/search/movie", { query, page, include_adult: "false" });

export async function searchView(ctx: ViewContext, query: string): Promise<void> {
  const first = await searchPage(query, 1);

  if (!first.results.length) {
    ctx.show(noticeHTML(`No films match “${query}”`, "Check the spelling or try fewer words."));
    return;
  }

  const shown = new Set<number>();
  const cards = (results: Movie[]) =>
    results
      .filter((m) => !shown.has(m.id) && shown.add(m.id)) // TMDB pages can overlap
      .map((m) => posterCard(m))
      .join("");

  const total = first.total_results.toLocaleString();
  if (!ctx.show(`
    <h2 class="section-title">${total} result${first.total_results === 1 ? "" : "s"} for “${esc(query)}”</h2>
    <div class="grid" id="results">${cards(first.results)}</div>
    <div class="more-row" id="more-row"></div>`)) return;

  const grid = find(ctx.el, "#results");
  const moreRow = find(ctx.el, "#more-row");
  let page = 1;

  const renderMore = () => {
    moreRow.innerHTML =
      page < first.total_pages ? `<button class="btn" id="more">Load more</button>` : "";
  };
  renderMore();

  moreRow.addEventListener("click", async (e) => {
    if (!(e.target as Element).closest("#more")) return;
    moreRow.innerHTML = loadingHTML(true);
    try {
      const next = await searchPage(query, page + 1);
      if (!ctx.current()) return;
      page += 1;
      grid.insertAdjacentHTML("beforeend", cards(next.results));
    } catch (err) {
      toast(errorMessage(err));
    }
    if (ctx.current()) renderMore();
  });
}
