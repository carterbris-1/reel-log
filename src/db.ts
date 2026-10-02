// "@supabase/supabase-js" is mapped to the jsDelivr CDN by the import map in
// index.html, so the browser loads it exactly as before. The npm copy in
// node_modules is only there so TypeScript knows its types.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import type { List, ListItem, ListMembership, Movie, Thumb, Vote } from "./types.js";

export const dbConfigured =
  !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.startsWith("YOUR_");

export const supabase: SupabaseClient | null = dbConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const UNAVAILABLE = "Lists are temporarily unavailable. Try again in a moment.";

/** The client, for code that only runs once Supabase is configured. */
function client(): SupabaseClient {
  if (!supabase) throw new Error(UNAVAILABLE);
  return supabase;
}

// Supabase returns { data, error } instead of throwing; convert to exceptions so
// callers can use try/catch. Network failures reject the promise itself.
// `T` is the row shape we asked for in select(...) — see types.ts.
async function run<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    result = await query;
  } catch {
    throw new Error(UNAVAILABLE);
  }
  if (result.error) {
    console.error(result.error);
    throw new Error(UNAVAILABLE);
  }
  return result.data as T;
}

const byAddedAt = (a: ListItem, b: ListItem) => a.added_at.localeCompare(b.added_at);

/** Every list with a light snapshot of its items (for the My Lists page). */
export async function getLists(): Promise<List[]> {
  const lists = await run<List[]>(
    client()
      .from("lists")
      .select("id, name, created_at, list_items(tmdb_id, title, poster_path, release_date, added_at)")
      .order("created_at", { ascending: false }),
  );
  for (const list of lists) list.list_items.sort(byAddedAt);
  return lists;
}

/** One list with all its items, or null if it doesn't exist (or isn't yours). */
export async function getList(id: string): Promise<List | null> {
  const list = await run<List | null>(
    client().from("lists").select("id, name, list_items(*)").eq("id", id).maybeSingle(),
  );
  list?.list_items.sort(byAddedAt);
  return list;
}

/** Every list, each with `contains` = whether the given film is in it. */
export async function getListsForMovie(tmdbId: number): Promise<ListMembership[]> {
  const lists = await run<{ id: string; name: string; list_items: { tmdb_id: number }[] }[]>(
    client()
      .from("lists")
      .select("id, name, list_items(tmdb_id)")
      .eq("list_items.tmdb_id", tmdbId)
      .order("created_at", { ascending: false }),
  );
  return lists.map((l) => ({ id: l.id, name: l.name, contains: l.list_items.length > 0 }));
}

export function createList(name: string): Promise<{ id: string; name: string }> {
  return run(client().from("lists").insert({ name }).select("id, name").single());
}

export function renameList(id: string, name: string): Promise<void> {
  return run(client().from("lists").update({ name }).eq("id", id));
}

export function deleteList(id: string): Promise<void> {
  return run(client().from("lists").delete().eq("id", id));
}

/** Adding a film that's already in the list is a no-op, not an error. */
export function addToList(listId: string, movie: Movie): Promise<void> {
  return run(
    client().from("list_items").upsert(
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

export function removeFromList(listId: string, tmdbId: number): Promise<void> {
  return run(client().from("list_items").delete().eq("list_id", listId).eq("tmdb_id", tmdbId));
}

// ── For You votes ─────────────────────────────────────────────────────────────

/** Every 👍/👎, newest first (History page and the recommender's training set). */
export function getVotes(): Promise<Vote[]> {
  return run(client().from("votes").select("tmdb_id, thumb, voted_at").order("voted_at", { ascending: false }));
}

/** Vote, flip, or re-stamp (Rewatch). One row per film, so this is an upsert. */
export function setVote(tmdbId: number, thumb: Thumb): Promise<void> {
  return run(
    client().from("votes").upsert(
      { tmdb_id: tmdbId, thumb, voted_at: new Date().toISOString() },
      { onConflict: "user_id,tmdb_id" },
    ),
  );
}

/** Forget a vote, so the film can be recommended again. */
export function removeVote(tmdbId: number): Promise<void> {
  return run(client().from("votes").delete().eq("tmdb_id", tmdbId));
}
