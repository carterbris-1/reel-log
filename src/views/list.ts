import { getList, renameList, deleteList, removeFromList } from "../db.js";
import { currentUser, openSignIn } from "../auth.js";
import { errorMessage, esc, find, noticeHTML, posterCard, toast } from "../ui.js";
import { openWheel } from "../wheel.js";
import type { ViewContext } from "../types.js";

const countText = (n: number) => `${n} film${n === 1 ? "" : "s"}`;

export async function listView(ctx: ViewContext, id: string): Promise<void> {
  if (!currentUser()) {
    ctx.show(noticeHTML(
      "Sign in to see this list",
      "",
      `<button class="btn btn-accent" data-signin>Sign in</button>`,
    ));
    ctx.el.querySelector("[data-signin]")?.addEventListener("click", openSignIn);
    return;
  }

  const list = await getList(id);
  if (!list) {
    ctx.show(noticeHTML("List not found", "It may have been deleted.", `<a class="btn" href="#/lists">My Lists</a>`));
    return;
  }

  let count = list.list_items.length;

  if (!ctx.show(`
    <div class="page-head">
      <div>
        <h1 id="list-name">${esc(list.name)}</h1>
        <div class="muted small" id="list-count">${countText(count)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-red" id="spin" ${count < 2 ? "disabled title=\"Add at least 2 films to randomize\"" : ""}>🎡 Randomize</button>
        <button class="btn btn-sm" id="rename">Rename</button>
        <button class="btn btn-sm btn-danger" id="delete">Delete</button>
      </div>
    </div>
    ${count
      ? `<div class="grid" id="items">${list.list_items.map((i) => posterCard(i, { removable: true })).join("")}</div>`
      : `<p class="muted">This list is empty. Search for a film and use “Add to list”.</p>`}`)) return;

  const nameEl = find(ctx.el, "#list-name");
  const countEl = find(ctx.el, "#list-count");
  const spinBtn = find<HTMLButtonElement>(ctx.el, "#spin");

  spinBtn.addEventListener("click", () => openWheel(list.list_items));

  find(ctx.el, "#rename").addEventListener("click", async () => {
    const name = prompt("Rename list", list.name)?.trim();
    if (!name || name === list.name) return;
    try {
      await renameList(id, name.slice(0, 100));
      list.name = name.slice(0, 100);
      nameEl.textContent = list.name;
      toast("Renamed");
    } catch (err) {
      toast(errorMessage(err));
    }
  });

  find(ctx.el, "#delete").addEventListener("click", async () => {
    if (!confirm(`Delete “${list.name}”? This can't be undone.`)) return;
    try {
      await deleteList(id);
      toast(`Deleted “${list.name}”`);
      location.hash = "#/lists";
    } catch (err) {
      toast(errorMessage(err));
    }
  });

  ctx.el.querySelector("#items")?.addEventListener("click", async (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("[data-remove]");
    if (!button) return;
    e.preventDefault(); // the button sits inside the card's link
    const tmdbId = Number(button.dataset.remove);
    const card = button.closest(".card");
    const title = card?.querySelector(".card-title")?.textContent ?? "film";
    button.disabled = true;
    try {
      await removeFromList(id, tmdbId);
      card?.remove();
      list.list_items = list.list_items.filter((i) => i.tmdb_id !== tmdbId);
      count -= 1;
      spinBtn.disabled = count < 2;
      countEl.textContent = countText(count);
      toast(`Removed “${title}”`);
    } catch (err) {
      button.disabled = false;
      toast(errorMessage(err));
    }
  });
}
