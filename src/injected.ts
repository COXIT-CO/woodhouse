/**
 * Runs in the page's MAIN world at document_start.
 * Wraps WebSocket, EventSource and console to observe traffic the extension
 * APIs can't see. Forwards everything to the bridge content script via
 * window.postMessage. Never blocks or alters page behaviour.
 */
(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w.__woodhouseInjected) return;
  w.__woodhouseInjected = true;

  const FRAME_CAP = 64 * 1024; // chars per WS frame / console arg
  const post = (kind: string, payload: Record<string, unknown>) => {
    try {
      window.postMessage({ __wh: 1, kind, ts: Date.now(), payload }, "*");
    } catch {
      /* never break the page */
    }
  };

  // ---------- serialization helpers ----------
  const truncate = (s: string): { data: string; truncated: boolean } =>
    s.length > FRAME_CAP ? { data: s.slice(0, FRAME_CAP), truncated: true } : { data: s, truncated: false };

  const serializeFrame = (d: unknown): { data: string; truncated: boolean; binary: boolean; size: number } => {
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

  const seen = () => new WeakSet<object>();
  const serializeArg = (v: unknown, depth = 0, ws = seen()): string => {
    try {
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      const t = typeof v;
      if (t === "string") return truncate(v as string).data;
      if (t === "number" || t === "boolean" || t === "bigint") return String(v);
      if (t === "function") return `[fn ${(v as { name?: string }).name || "anonymous"}]`;
      if (t === "symbol") return String(v);
      if (v instanceof Error) {
        const stack = (v.stack || "").split("\n").slice(0, 4).join("\n");
        return `${v.name}: ${v.message}\n${stack}`;
      }
      if (v instanceof Node) {
        const el = v as Element;
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "";
        return `<${(el.tagName || v.nodeName || "node").toLowerCase()}${id}${cls}>`;
      }
      if (depth >= 3) return Array.isArray(v) ? `[Array(${v.length})]` : "[Object]";
      if (ws.has(v as object)) return "[Circular]";
      ws.add(v as object);
      if (Array.isArray(v)) {
        const items = v.slice(0, 20).map((x) => serializeArg(x, depth + 1, ws));
        return `[${items.join(", ")}${v.length > 20 ? `, …${v.length - 20} more` : ""}]`;
      }
      const entries = Object.entries(v as object).slice(0, 20);
      const body = entries.map(([k, val]) => `${k}: ${serializeArg(val, depth + 1, ws)}`).join(", ");
      return `{${body}${Object.keys(v as object).length > 20 ? ", …" : ""}}`;
    } catch {
      return "[unserializable]";
    }
  };

  // ---------- WebSocket ----------
  const NativeWS = window.WebSocket;
  if (NativeWS) {
    let wsId = 0;
    const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
      const id = ++wsId;
      post("ws-open", { id, url: String(url), protocols });
      ws.addEventListener("message", (e: MessageEvent) => post("ws-frame", { id, dir: "in", ...serializeFrame(e.data) }));
      ws.addEventListener("close", (e: CloseEvent) =>
        post("ws-close", { id, code: e.code, reason: e.reason, wasClean: e.wasClean })
      );
      ws.addEventListener("error", () => post("ws-error", { id }));
      const origSend = ws.send.bind(ws);
      ws.send = (d: Parameters<WebSocket["send"]>[0]) => {
        post("ws-frame", { id, dir: "out", ...serializeFrame(d) });
        return origSend(d);
      };
      return ws;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = NativeWS.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) {
      Object.defineProperty(Wrapped, k, { value: NativeWS[k] });
    }
    try {
      window.WebSocket = Wrapped;
    } catch {
      /* frozen — give up silently */
    }
  }

  // ---------- EventSource (SSE) ----------
  const NativeES = window.EventSource;
  if (NativeES) {
    let esId = 0;
    const WrappedES = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      const es = init === undefined ? new NativeES(url) : new NativeES(url, init);
      const id = ++esId;
      post("sse-open", { id, url: String(url) });
      es.addEventListener("message", (e: MessageEvent) =>
        post("sse-message", { id, ...serializeFrame(typeof e.data === "string" ? e.data : String(e.data)) })
      );
      es.addEventListener("error", () => post("sse-error", { id }));
      return es;
    } as unknown as typeof EventSource;
    WrappedES.prototype = NativeES.prototype;
    try {
      window.EventSource = WrappedES;
    } catch {
      /* ignore */
    }
  }

  // ---------- console ----------
  const LEVELS = ["log", "info", "warn", "error", "debug", "trace"] as const;
  for (const level of LEVELS) {
    const orig = console[level].bind(console);
    try {
      console[level] = (...args: unknown[]) => {
        post("console", { level, args: args.map((a) => serializeArg(a)) });
        orig(...args);
      };
    } catch {
      /* ignore */
    }
  }
  window.addEventListener("error", (e) =>
    post("console", {
      level: "uncaught",
      args: [`${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`],
    })
  );
  window.addEventListener("unhandledrejection", (e) =>
    post("console", { level: "unhandledrejection", args: [serializeArg(e.reason)] })
  );
})();
