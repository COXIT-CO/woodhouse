import { h } from "./dom";

// storage.local, not sync: a flag synced from another device could hide the banner where it was never seen.
const STORAGE_KEY = "wh_onboarding_dismissed";

const TAB_BLURBS: [string, string][] = [
  ["Requests", "live HTTP capture with headers, bodies and copy-as-cURL."],
  ["WS/SSE", "WebSocket and Server-Sent-Events connections with a frame timeline."],
  ["Console", "page console output, including uncaught errors and rejections."],
  ["Sources", "inventory of loaded scripts, styles and documents."],
  ["Insights", "press Analyze for ranked findings: duplicates, headers, privacy, secrets."],
];

export async function getOnboardingDismissed(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    return got[STORAGE_KEY] === true;
  } catch {
    return false;
  }
}

export async function setOnboardingDismissed(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  } catch {
    /* worst case the banner shows again next open */
  }
}

/** onDismiss lets the caller drop its reference — main.ts re-appends the banner on every full re-render. */
export function renderOnboardingBanner(onDismiss: () => void): HTMLElement {
  const banner = h(
    "div",
    { class: "onboarding-banner" },
    h(
      "button",
      {
        class: "dismiss",
        title: "Dismiss",
        onclick: () => {
          void setOnboardingDismissed();
          banner.remove();
          onDismiss();
        },
      },
      "Got it"
    ),
    h("div", { class: "title" }, "Welcome to Woodhouse"),
    h("ul", {}, ...TAB_BLURBS.map(([tab, blurb]) => h("li", {}, h("b", {}, tab), ` — ${blurb}`))),
    h("div", { class: "local" }, "All analysis runs locally — nothing ever leaves your browser.")
  );
  return banner;
}
