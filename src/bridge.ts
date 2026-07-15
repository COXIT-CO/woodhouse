/**
 * Content script (ISOLATED world). Relays events posted by injected.ts
 * to the service worker, batched to survive console floods.
 */
import type { WhEvent } from "./shared/types";

const queue: WhEvent[] = [];
const MAX_QUEUE = 2000;
let dropped = 0;

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as { __wh?: number; kind?: string; ts?: number; payload?: Record<string, unknown> };
  if (!d || d.__wh !== 1 || !d.kind) return;
  if (queue.length >= MAX_QUEUE) {
    dropped++;
    return;
  }
  queue.push({ kind: d.kind as WhEvent["kind"], ts: d.ts || Date.now(), payload: d.payload || {} });
});

setInterval(() => {
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  const d = dropped;
  dropped = 0;
  try {
    chrome.runtime.sendMessage({ __whBridge: 1, events, dropped: d }).catch(() => {});
  } catch {
    /* extension context invalidated (reload) — ignore */
  }
}, 250);
