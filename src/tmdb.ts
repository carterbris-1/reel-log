import { TMDB_API_KEY } from "./config.js";

export const tmdbConfigured = Boolean(TMDB_API_KEY) && !TMDB_API_KEY.startsWith("YOUR_");

// The v4 "API Read Access Token" is a JWT (starts with eyJ) and goes in a header;
// the shorter v3 "API Key" goes in the query string.
const useBearer = TMDB_API_KEY.startsWith("eyJ");

/** GET a TMDB endpoint. `T` is the response shape the caller expects (see types.ts). */
export async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  if (!useBearer) url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let res: Response;
  try {
    res = await fetch(url, useBearer ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } } : undefined);
  } catch {
    throw new Error("Couldn't reach TMDB. Check your connection and try again.");
  }
  if (res.status === 401) throw new Error("TMDB rejected the API key. Check TMDB_API_KEY in src/config.ts.");
  if (res.status === 404) throw new Error("TMDB doesn't have that page.");
  if (!res.ok) throw new Error(`TMDB returned an error (${res.status}). Try again.`);
  return res.json() as Promise<T>;
}

export function img(path: string | null | undefined, size = "w342"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
