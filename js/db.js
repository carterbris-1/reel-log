import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

export const dbConfigured =
  !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.startsWith("YOUR_");

export const supabase = dbConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const UNAVAILABLE = "Lists are temporarily unavailable. Try again in a moment.";

// Supabase returns { data, error } instead of throwing; convert to exceptions so
// callers can use try/catch. Network failures reject the promise itself.
async function run(query) {
  let result;
  try {
    result = await query;
  } catch {
    throw new Error(UNAVAILABLE);
  }
  if (result.error) {
    console.error(result.error);
    throw new Error(UNAVAILABLE);
  }
  return result.data;
}

const byAddedAt = (a, b) => a.added_at.localeCompare(b.added_at);

/** Every list with a light snapshot of its items (for the My Lists page). */
export async function getLists() {
  const lists = await run(
    supabase
      .from("lists")
      .select("id, name, created_at, list_items(tmdb_id, title, poster_path, release_date, added_at)")
      .order("created_at", { ascending: false }),
  );
  for (const list of lists) list.list_items.sort(byAddedAt);
  return lists;
}

/** One list with all its items, or null if it doesn't exist (or isn't yours). */
export async function getList(id) {
  const list = await run(
    supabase.from("lists").select("id, name, list_items(*)").eq("id", id).maybeSingle(),
  );
  list?.list_items.sort(byAddedAt);
  return list;
}

/** Every list, each with `contains` = whether the given film is in it. */
export async function getListsForMovie(tmdbId) {
  const lists = await run(
    supabase
      .from("lists")
      .select("id, name, list_items(tmdb_id)")
      .eq("list_items.tmdb_id", tmdbId)
      .order("created_at", { ascending: false }),
  );
  return lists.map((l) => ({ id: l.id, name: l.name, contains: l.list_items.length > 0 }));
}

export function createList(name) {
  return run(supabase.from("lists").insert({ name }).select("id, name").single());
}

export function renameList(id, name) {
  return run(supabase.from("lists").update({ name }).eq("id", id));
}

export function deleteList(id) {
  return run(supabase.from("lists").delete().eq("id", id));
}

/** Adding a film that's already in the list is a no-op, not an error. */
export function addToList(listId, movie) {
  return run(
    supabase.from("list_items").upsert(
      {
        list_id: listId,
        tmdb_id: movie.id,
        title: movie.title,
        poster_path: movie.poster_path || null,
        release_date: movie.release_date || null,
      },
      { onConflict: "list_id,tmdb_id", ignoreDuplicates: true },
    ),
  );
}

export function removeFromList(listId, tmdbId) {
  return run(supabase.from("list_items").delete().eq("list_id", listId).eq("tmdb_id", tmdbId));
}
