// iPhone-specific behaviour. iOS Safari and "Add to Home Screen" apps differ from
// desktop browsers in ways the rest of the app has to account for — see §11 of
// CODE_GUIDE.md for the full list.

// `navigator.standalone` is an Apple-only property, so TypeScript's DOM types don't
// include it.
const appleNavigator = navigator as Navigator & { standalone?: boolean };

// iPadOS reports itself as a Mac, so also check for a touch screen.
export const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Launched from the Home Screen icon (full-screen, no Safari toolbar or Back button).
export const isStandalone =
  appleNavigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// iOS Safari only applies :active (the press feedback in styles.css) when the page
// has a touchstart listener. An empty passive one is enough.
document.addEventListener("touchstart", () => {}, { passive: true });

const TIP_KEY = "reel-log:home-screen-tip-dismissed";

// Safari's Share icon: a box with an arrow pointing up out of it.
const SHARE_ICON = `<svg class="share-glyph" viewBox="0 0 16 20" aria-hidden="true"><path d="M8 1v11M4.5 4.5 8 1l3.5 3.5M5 8H2.5v10.5h11V8H11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tipDismissed(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Safari deletes a site's saved data — including your sign-in — if you don't open it
 * for about a week. Home Screen apps are exempt, so suggest adding one.
 * Returns "" everywhere except iPhone/iPad Safari.
 */
export function homeScreenTipHTML(): string {
  if (!isIOS || isStandalone || tipDismissed()) return "";
  return `
    <div class="ios-tip" id="ios-tip">
      <div>
        <strong>On iPhone? Add Reel Log to your Home Screen.</strong>
        Tap ${SHARE_ICON} Share → <em>Add to Home Screen</em>.
        It opens full-screen like an app, and it keeps you signed in. Safari may sign you out
        if you don't visit for about a week.
      </div>
      <button class="icon-btn" id="ios-tip-close" aria-label="Dismiss">✕</button>
    </div>`;
}

export function bindHomeScreenTip(root: ParentNode): void {
  root.querySelector("#ios-tip-close")?.addEventListener("click", () => {
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      // private browsing: the tip just comes back next visit
    }
    root.querySelector("#ios-tip")?.remove();
  });
}
