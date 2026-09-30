import { getLists, createList } from "../db.js";
import { currentUser, openSignIn } from "../auth.js";
import { errorMessage, esc, find, noticeHTML, toast } from "../ui.js";
import { img } from "../tmdb.js";
import { homeScreenTipHTML, bindHomeScreenTip } from "../ios.js";
import { openWheel } from "../wheel.js";
import type { List, ViewContext } from "../types.js";

function listCard(list: List): string {
  const items = list.list_items;
  const stack = items
    .slice(0, 4)
    .map((i) => {
      const src = img(i.poster_path, "w185");
      return `<div>${src ? `<img src="${src}" alt="" loading="lazy">` : ""}</div>`;
    })
    .join("");
  // The Randomize button sits beside the link, not inside it, so tapping it on a
  // phone can't also open the list.
  return `
    <div class="list-card">
      <a href="#/list/${list.id}">
        <div class="stackposters">${stack || "<div></div>"}</div>
        <h3>${esc(list.name)}</h3>
        <div class="muted small">${items.length} film${items.length === 1 ? "" : "s"}</div>
      </a>
      <button class="btn btn-sm btn-red list-card-spin" data-spin="${list.id}"
        ${items.length < 2 ? "disabled title=\"Add at least 2 films to randomize\"" : ""}>🎡 Randomize</button>
    </div>`;
}

export async function listsView(ctx: ViewContext): Promise<void> {
  if (!currentUser()) {
    ctx.show(noticeHTML(
      "Sign in to see your lists",
      "Lists are saved to your account, so they're the same on your phone and computer.",
      `<button class="btn btn-accent" data-signin>Sign in</button>`,
    ) + homeScreenTipHTML());
    ctx.el.querySelector("[data-signin]")?.addEventListener("click", openSignIn);
    bindHomeScreenTip(ctx.el);
    return;
  }

  const lists = await getLists();

  if (!ctx.show(`
    ${homeScreenTipHTML()}
    <div class="page-head"><h1>My Lists</h1></div>
    <form class="inline-form new-list-form" id="new-list-form">
      <input name="name" placeholder="New list name, e.g. “Watch this summer”" maxlength="100" required>
      <button class="btn btn-accent">Create list</button>
    </form>
    ${lists.length
      ? `<div class="list-grid">${lists.map(listCard).join("")}</div>`
      : `<p class="muted">No lists yet. Create one above, or use “Add to list” on any film.</p>`}`)) return;

  bindHomeScreenTip(ctx.el);

  ctx.el.querySelector(".list-grid")?.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-spin]");
    if (!button) return;
    const list = lists.find((l) => l.id === button.dataset.spin);
    if (list) openWheel(list.list_items);
  });

  find<HTMLFormElement>(ctx.el, "#new-list-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const createBtn = find<HTMLButtonElement>(form, "button");
    const name = find<HTMLInputElement>(form, "input").value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      await createList(name);
      toast(`Created “${name}”`);
      ctx.rerender();
    } catch (err) {
      toast(errorMessage(err));
      createBtn.disabled = false;
    }
  });
}
