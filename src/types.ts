// Shapes of the data that moves through the app. TMDB types list only the fields we
// use; TMDB sends more. Nullable fields are ones TMDB (or our database) really does
// leave empty for some films and people.

// ── TMDB ──────────────────────────────────────────────────────────────────────

/** A film as it appears in search results, trending, and filmographies. */
export interface Movie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date?: string; // "2010-07-15"; missing or "" for unannounced films
}

/** One page of a paged TMDB response (search, trending). */
export interface Paged<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
}

/** One release event, e.g. US theatrical on 2010-07-16. */
export interface ReleaseDate {
  type: number; // 1 Premiere … 6 TV — see RELEASE_TYPES in views/movie.ts
  release_date: string; // ISO timestamp
  certification: string; // "PG-13", or "" when none
  note: string;
}

/** `/movie/{id}?append_to_response=credits,release_dates` */
export interface MovieDetails extends Movie {
  backdrop_path: string | null;
  tagline: string;
  overview: string;
  runtime: number | null;
  genres: { id: number; name: string }[];
  credits: { cast: CastMember[]; crew: CrewMember[] };
  release_dates: { results: { iso_3166_1: string; release_dates: ReleaseDate[] }[] };
}

/** `/person/{id}?append_to_response=movie_credits` */
export interface PersonDetails {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  biography: string;
  movie_credits: { cast: Movie[]; crew: (Movie & { job: string })[] };
}

// ── Our database (supabase/schema.sql) ────────────────────────────────────────

/** A row of `list_items`: a snapshot of a film saved in a list. */
export interface ListItem {
  list_id?: string; // present when selected with list_items(*)
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  release_date: string | null;
  added_at: string;
}

/** A row of `lists` with its films embedded. */
export interface List {
  id: string;
  name: string;
  created_at?: string;
  list_items: ListItem[];
}

/** A list plus whether one particular film is in it (Add-to-list panel). */
export interface ListMembership {
  id: string;
  name: string;
  contains: boolean;
}

// ── App plumbing ──────────────────────────────────────────────────────────────

/** What the router hands every view. See app.ts. */
export interface ViewContext {
  /** The <main id="app"> element views draw into. */
  el: HTMLElement;
  /** False once a newer render has started (you navigated away). */
  current(): boolean;
  /** Replace the page, unless a newer render has started. Returns whether it drew. */
  show(html: string): boolean;
  /** Re-run the current route without scrolling to the top. */
  rerender(): Promise<void>;
}
