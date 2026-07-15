"use strict";
(() => {
  // src/bridge.ts
  var queue = [];
  var MAX_QUEUE = 2e3;
  var dropped = 0;
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__wh !== 1 || !d.kind) return;
    if (queue.length >= MAX_QUEUE) {
      dropped++;
      return;
    }
    queue.push({ kind: d.kind, ts: d.ts || Date.now(), payload: d.payload || {} });
  });
  setInterval(() => {
    if (queue.length === 0) return;
    const events = queue.splice(0, queue.length);
    const d = dropped;
    dropped = 0;
    try {
      chrome.runtime.sendMessage({ __whBridge: 1, events, dropped: d }).catch(() => {
      });
    } catch {
    }
  }, 250);
})();
