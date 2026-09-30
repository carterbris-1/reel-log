import type { User } from "@supabase/supabase-js";
import { supabase, dbConfigured } from "./db.js";
import { byId, esc, find, toast } from "./ui.js";

let user: User | null = null;
export const currentUser = (): User | null => user;

const dialog = byId<HTMLDialogElement>("auth-dialog");
const form = byId<HTMLFormElement>("auth-form");
const errorEl = byId("auth-error");
const submit = byId<HTMLButtonElement>("auth-submit");
const slot = byId("auth-slot");
const emailInput = byId<HTMLInputElement>("auth-email");
const passwordInput = byId<HTMLInputElement>("auth-password");

export function openSignIn(): void {
  errorEl.hidden = true;
  form.reset();
  dialog.showModal();
}

function renderSlot(): void {
  if (!dbConfigured) {
    slot.innerHTML = "";
  } else if (user) {
    const initial = (user.email || "?")[0].toUpperCase();
    slot.innerHTML = `
      <span class="avatar" title="${esc(user.email)}">${esc(initial)}</span>
      <button class="btn btn-sm" id="sign-out">Sign out</button>`;
    find(slot, "#sign-out").addEventListener("click", async () => {
      // "local" signs out this device only. Supabase's default ("global") would also
      // end the session on your other devices.
      await supabase?.auth.signOut({ scope: "local" });
      toast("Signed out");
    });
  } else {
    slot.innerHTML = `<button class="btn btn-sm btn-accent" id="sign-in">Sign in</button>`;
    find(slot, "#sign-in").addEventListener("click", openSignIn);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase) return;
  submit.disabled = true;
  errorEl.hidden = true;
  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  submit.disabled = false;
  if (error) {
    errorEl.textContent =
      error.message === "Invalid login credentials" ? "Wrong email or password." : error.message;
    errorEl.hidden = false;
    return;
  }
  dialog.close();
  toast("Signed in");
});

/**
 * Restores the saved session, then calls onChange whenever the signed-in user changes
 * (sign in / sign out, including from another tab).
 */
export async function initAuth(onChange: () => void): Promise<void> {
  if (!supabase) {
    renderSlot();
    return;
  }
  const { data } = await supabase.auth.getSession();
  user = data.session?.user ?? null;
  renderSlot();

  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null;
    if (next?.id === user?.id) return; // token refreshes etc.
    user = next;
    renderSlot();
    // Supabase warns against awaiting its own calls inside this callback.
    setTimeout(onChange, 0);
  });
}
