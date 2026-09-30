// ─── Fill these in (see README.md) ─────────────────────────────────────────
// Everything here is safe to publish. The TMDB key is read-only, and the
// Supabase anon/publishable key is public by design — your lists are protected
// by the row-level security rules in supabase/schema.sql.
// NEVER put the Supabase "service_role" / secret key here.

// TMDB → https://www.themoviedb.org/settings/api
// Either the "API Key" or the longer "API Read Access Token" works.
export const TMDB_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4NWJjMDBhOGUxZjU4ZmI5N2MwMDAzMWZkMDEyNzdmNCIsIm5iZiI6MTc5MDcyNjQ5OS4zMzEsInN1YiI6IjZhYmM1MTYzZGRkMzViNmJlMTFjNzhlNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.UiZrXNiAXV219fuXu8FsbCyXLG_4P1QI2ONQjnO3ABg";

// Supabase → Project Settings → API (or Data API)
export const SUPABASE_URL = "https://gpwbwagzsafeoucvyxhx.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_QyaRo7EK8En_5oc76osq_w_BzQT8Dc8";
