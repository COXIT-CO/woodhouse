"use strict";
(() => {
  // src/injected.ts
  (() => {
    const w = window;
    if (w.__woodhouseInjected) return;
    w.__woodhouseInjected = true;
    const FRAME_CAP = 64 * 1024;
    const post = (kind, payload) => {
      try {
        window.postMessage({ __wh: 1, kind, ts: Date.now(), payload }, "*");
      } catch {
      }
    };
    const truncate = (s) => s.length > FRAME_CAP ? { data: s.slice(0, FRAME_CAP), truncated: true } : { data: s, truncated: false };
    const serializeFrame = (d) => {
      if (typeof d === "string") {
        const t = truncate(d);
        return { ...t, binary: false, size: d.length };
      }
      let size = 0;
      if (d instanceof ArrayBuffer) size = d.byteLength;
      else if (ArrayBuffer.isView(d)) size = d.byteLength;
      else if (typeof Blob !== "undefined" && d instanceof Blob) size = d.size;
      return { data: `[binary ${size} bytes]`, truncated: false, binary: true, size };
    };
    const seen = () => /* @__PURE__ */ new WeakSet();
    const serializeArg = (v, depth = 0, ws = seen()) => {
      try {
        if (v === null) return "null";
        if (v === void 0) return "undefined";
        const t = typeof v;
        if (t === "string") return truncate(v).data;
        if (t === "number" || t === "boolean" || t === "bigint") return String(v);
        if (t === "function") return `[fn ${v.name || "anonymous"}]`;
        if (t === "symbol") return String(v);
        if (v instanceof Error) {
          const stack = (v.stack || "").split("\n").slice(0, 4).join("\n");
          return `${v.name}: ${v.message}
${stack}`;
        }
        if (v instanceof Node) {
          const el = v;
          const id = el.id ? `#${el.id}` : "";
          const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "";
          return `<${(el.tagName || v.nodeName || "node").toLowerCase()}${id}${cls}>`;
        }
        if (depth >= 3) return Array.isArray(v) ? `[Array(${v.length})]` : "[Object]";
        if (ws.has(v)) return "[Circular]";
        ws.add(v);
        if (Array.isArray(v)) {
          const items = v.slice(0, 20).map((x) => serializeArg(x, depth + 1, ws));
          return `[${items.join(", ")}${v.length > 20 ? `, \u2026${v.length - 20} more` : ""}]`;
        }
        const entries = Object.entries(v).slice(0, 20);
        const body = entries.map(([k, val]) => `${k}: ${serializeArg(val, depth + 1, ws)}`).join(", ");
        return `{${body}${Object.keys(v).length > 20 ? ", \u2026" : ""}}`;
      } catch {
        return "[unserializable]";
      }
    };
    const NativeWS = window.WebSocket;
    if (NativeWS) {
      let wsId = 0;
      const Wrapped = function(url, protocols) {
        const ws = protocols === void 0 ? new NativeWS(url) : new NativeWS(url, protocols);
        const id = ++wsId;
        post("ws-open", { id, url: String(url), protocols });
        ws.addEventListener("message", (e) => post("ws-frame", { id, dir: "in", ...serializeFrame(e.data) }));
        ws.addEventListener(
          "close",
          (e) => post("ws-close", { id, code: e.code, reason: e.reason, wasClean: e.wasClean })
        );
        ws.addEventListener("error", () => post("ws-error", { id }));
        const origSend = ws.send.bind(ws);
        ws.send = (d) => {
          post("ws-frame", { id, dir: "out", ...serializeFrame(d) });
          return origSend(d);
        };
        return ws;
      };
      Wrapped.prototype = NativeWS.prototype;
      for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
        Object.defineProperty(Wrapped, k, { value: NativeWS[k] });
      }
      try {
        window.WebSocket = Wrapped;
      } catch {
      }
    }
    const NativeES = window.EventSource;
    if (NativeES) {
      let esId = 0;
      const WrappedES = function(url, init) {
        const es = init === void 0 ? new NativeES(url) : new NativeES(url, init);
        const id = ++esId;
        post("sse-open", { id, url: String(url) });
        es.addEventListener(
          "message",
          (e) => post("sse-message", { id, ...serializeFrame(typeof e.data === "string" ? e.data : String(e.data)) })
        );
        es.addEventListener("error", () => post("sse-error", { id }));
        return es;
      };
      WrappedES.prototype = NativeES.prototype;
      try {
        window.EventSource = WrappedES;
      } catch {
      }
    }
    const LEVELS = ["log", "info", "warn", "error", "debug", "trace"];
    for (const level of LEVELS) {
      const orig = console[level].bind(console);
      try {
        console[level] = (...args) => {
          post("console", { level, args: args.map((a) => serializeArg(a)) });
          orig(...args);
        };
      } catch {
      }
    }
    window.addEventListener(
      "error",
      (e) => post("console", {
        level: "uncaught",
        args: [`${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`]
      })
    );
    window.addEventListener(
      "unhandledrejection",
      (e) => post("console", { level: "unhandledrejection", args: [serializeArg(e.reason)] })
    );
  })();
})();
