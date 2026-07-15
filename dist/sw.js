"use strict";
(() => {
  // src/sw.ts
  var panels = /* @__PURE__ */ new Map();
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "wh-panel") return;
    let boundTab = null;
    port.onMessage.addListener((msg) => {
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
    if (tabId === void 0) return;
    const port = panels.get(tabId);
    if (!port) return;
    try {
      port.postMessage({ type: "events", events: msg.events, dropped: msg.dropped });
    } catch {
      panels.delete(tabId);
    }
  });
})();
