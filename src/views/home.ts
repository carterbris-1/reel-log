import { tmdb } from "../tmdb.js";
import { posterCard } from "../ui.js";
import type { Movie, Paged, ViewContext } from "../types.js";

export async function homeView(ctx: ViewContext): Promise<void> {
  const data = await tmdb<Paged<Movie>>("/trending/movie/week");
  ctx.show(`
    <h2 class="section-title">Now Showing <span>· Trending this week</span></h2>
    <div class="grid">${data.results.map((m) => posterCard(m)).join("")}</div>`);
}
