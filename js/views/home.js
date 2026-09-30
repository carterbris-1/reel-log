import { tmdb } from "../tmdb.js";
import { posterCard } from "../ui.js";

export async function homeView(ctx) {
  const data = await tmdb("/trending/movie/week");
  ctx.show(`
    <h2 class="section-title">Now Showing <span>· Trending this week</span></h2>
    <div class="grid">${data.results.map((m) => posterCard(m)).join("")}</div>`);
}
