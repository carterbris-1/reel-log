import { tmdb } from "../tmdb.js";
import { esc, loadingHTML, noticeHTML, posterCard, toast } from "../ui.js";

const searchPage = (query, page) =>
  tmdb("/search/movie", { query, page, include_adult: "false" });

export async function searchView(ctx, query) {
  const first = await searchPage(query, 1);

  if (!first.results.length) {
    ctx.show(noticeHTML(`No films match “${query}”`, "Check the spelling or try fewer words."));
    return;
  }

  const shown = new Set();
  const cards = (results) =>
    results
      .filter((m) => !shown.has(m.id) && shown.add(m.id)) // TMDB pages can overlap
      .map((m) => posterCard(m))
      .join("");

  const total = first.total_results.toLocaleString();
  if (!ctx.show(`
    <h2 class="section-title">${total} result${first.total_results === 1 ? "" : "s"} for “${esc(query)}”</h2>
    <div class="grid" id="results">${cards(first.results)}</div>
    <div class="more-row" id="more-row"></div>`)) return;

  const grid = ctx.el.querySelector("#results");
  const moreRow = ctx.el.querySelector("#more-row");
  let page = 1;

  const renderMore = () => {
    moreRow.innerHTML =
      page < first.total_pages ? `<button class="btn" id="more">Load more</button>` : "";
  };
  renderMore();

  moreRow.addEventListener("click", async (e) => {
    if (!e.target.closest("#more")) return;
    moreRow.innerHTML = loadingHTML(true);
    try {
      const next = await searchPage(query, page + 1);
      if (!ctx.current()) return;
      page += 1;
      grid.insertAdjacentHTML("beforeend", cards(next.results));
    } catch (err) {
      toast(err.message);
    }
    if (ctx.current()) renderMore();
  });
}
