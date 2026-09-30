import { TMDB_API_KEY } from "../config.js";

export const tmdbConfigured = Boolean(TMDB_API_KEY) && !TMDB_API_KEY.startsWith("YOUR_");

// The v4 "API Read Access Token" is a JWT (starts with eyJ) and goes in a header;
// the shorter v3 "API Key" goes in the query string.
const useBearer = TMDB_API_KEY.startsWith("eyJ");

export async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  if (!useBearer) url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let res;
  try {
    res = await fetch(url, useBearer ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } } : undefined);
  } catch {
    throw new Error("Couldn't reach TMDB. Check your connection and try again.");
  }
  if (res.status === 401) throw new Error("TMDB rejected the API key. Check TMDB_API_KEY in config.js.");
  if (res.status === 404) throw new Error("TMDB doesn't have that page.");
  if (!res.ok) throw new Error(`TMDB returned an error (${res.status}). Try again.`);
  return res.json();
}

export function img(path, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
