/**
 * Service worker: pure message router.
 * Bridges (per tab) -> panel ports (per inspected tab).
 */
const panels = new Map<number, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "wh-panel") return;
  let boundTab: number | null = null;
  port.onMessage.addListener((msg: { type?: string; tabId?: number }) => {
    if (msg.type === "init" && typeof msg.tabId === "number") {
      boundTab = msg.tabId;
      panels.set(boundTab, port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (boundTab !== null && panels.get(boundTab) === port) panels.delete(boundTab);
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.__whBridge !== 1) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const port = panels.get(tabId);
  if (!port) return;
  try {
    port.postMessage({ type: "events", events: msg.events, dropped: msg.dropped });
  } catch {
    panels.delete(tabId);
  }
});
