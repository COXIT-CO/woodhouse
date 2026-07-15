import type { ConsoleLevel, ReqEntry, SourceMeta, WhEvent, WsConn } from "../shared/types";
import { CAPS, clearStore, newReqId, notify, pushConsole, pushRequest, store } from "./state";

const BODY_CAP = 1_000_000; // chars
const TEXTUAL_MIME = /json|text|xml|javascript|x-www-form-urlencoded|graphql/i;

type HarEntry = {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
    queryString: { name: string; value: string }[];
    postData?: { text?: string };
  };
  response: {
    status: number;
    statusText: string;
    headers: { name: string; value: string }[];
    content: { size: number; mimeType: string };
    _transferSize?: number;
  };
  cache?: { beforeRequest?: unknown; afterRequest?: unknown };
  _resourceType?: string;
};

function harToEntry(e: HarEntry, backfilled = false): ReqEntry {
  return {
    id: newReqId(),
    startedAt: Date.parse(e.startedDateTime) || Date.now(),
    method: e.request.method,
    url: e.request.url,
    status: e.response.status,
    statusText: e.response.statusText,
    mimeType: e.response.content?.mimeType || "",
    resourceType: e._resourceType || "",
    reqHeaders: e.request.headers || [],
    resHeaders: e.response.headers || [],
    queryString: e.request.queryString || [],
    postData: e.request.postData?.text,
    bodySize: e.response.content?.size ?? -1,
    transferSize: e.response._transferSize ?? -1,
    time: Math.round(e.time || 0),
    fromCache: !!(e.cache && (e.cache.beforeRequest || e.cache.afterRequest)),
    isBackfilled: backfilled,
    bodyUnavailable: backfilled,
  };
}

export function startCapture(): void {
  store.pageOrigin = "";
  chrome.devtools.inspectedWindow.eval("location.origin", (result) => {
    if (typeof result === "string") store.pageOrigin = result;
  });

  // ---- HTTP via devtools.network ----
  chrome.devtools.network.getHAR((harLog) => {
    for (const e of (harLog.entries as unknown as HarEntry[]) || []) pushRequest(harToEntry(e, true));
  });

  chrome.devtools.network.onRequestFinished.addListener((req) => {
    const e = req as unknown as HarEntry & { getContent(cb: (content: string, encoding: string) => void): void };
    const entry = harToEntry(e);
    pushRequest(entry);
    const size = e.response.content?.size ?? 0;
    if (TEXTUAL_MIME.test(entry.mimeType) && size >= 0 && size < BODY_CAP * 2) {
      try {
        e.getContent((content, encoding) => {
          if (content == null) {
            entry.bodyUnavailable = true;
          } else if (encoding === "base64") {
            entry.bodyUnavailable = true; // binary — skip
          } else {
            entry.body = content.length > BODY_CAP ? content.slice(0, BODY_CAP) : content;
            entry.bodyTruncated = content.length > BODY_CAP;
          }
          notify();
        });
      } catch {
        entry.bodyUnavailable = true;
      }
    }
  });

  chrome.devtools.network.onNavigated.addListener((url) => {
    if (!store.preserveLog) clearStore();
    try {
      store.pageOrigin = new URL(url).origin;
    } catch {
      /* ignore */
    }
    notify();
  });

  // ---- WS / SSE / console via SW port ----
  const port = chrome.runtime.connect({ name: "wh-panel" });
  port.postMessage({ type: "init", tabId: chrome.devtools.inspectedWindow.tabId });
  port.onMessage.addListener((msg: { type: string; events?: WhEvent[]; dropped?: number }) => {
    if (msg.type !== "events" || !msg.events) return;
    if (msg.dropped) store.eventsDropped += msg.dropped;
    for (const ev of msg.events) handleEvent(ev);
    notify();
  });
}

function connFor(map: Map<number, WsConn>, id: number, url = "?", ts = Date.now()): WsConn {
  let c = map.get(id);
  if (!c) {
    c = { id, url, openedAt: ts, frames: [], framesDropped: 0 };
    map.set(id, c);
  }
  return c;
}

function handleEvent(ev: WhEvent): void {
  const p = ev.payload as Record<string, never> & Record<string, unknown>;
  switch (ev.kind) {
    case "ws-open": {
      const c = connFor(store.wsConns, p.id as number, p.url as string, ev.ts);
      c.url = p.url as string;
      c.protocols = p.protocols as string | string[] | undefined;
      break;
    }
    case "ws-frame": {
      const c = connFor(store.wsConns, p.id as number, undefined, ev.ts);
      if (c.frames.length >= CAPS.framesPerConn) {
        c.framesDropped++;
        break;
      }
      c.frames.push({
        ts: ev.ts,
        dir: p.dir as "in" | "out",
        data: p.data as string,
        truncated: p.truncated as boolean,
        binary: p.binary as boolean,
        size: (p.size as number) ?? 0,
      });
      break;
    }
    case "ws-close": {
      const c = connFor(store.wsConns, p.id as number, undefined, ev.ts);
      c.closedAt = ev.ts;
      c.closeCode = p.code as number;
      c.closeReason = p.reason as string;
      break;
    }
    case "ws-error": {
      connFor(store.wsConns, p.id as number, undefined, ev.ts).error = true;
      break;
    }
    case "sse-open": {
      const c = connFor(store.sseConns, p.id as number, p.url as string, ev.ts);
      c.url = p.url as string;
      break;
    }
    case "sse-message": {
      const c = connFor(store.sseConns, p.id as number, undefined, ev.ts);
      if (c.frames.length >= CAPS.framesPerConn) {
        c.framesDropped++;
        break;
      }
      c.frames.push({
        ts: ev.ts,
        dir: "in",
        data: p.data as string,
        truncated: p.truncated as boolean,
        binary: false,
        size: (p.size as number) ?? 0,
      });
      break;
    }
    case "sse-error": {
      connFor(store.sseConns, p.id as number, undefined, ev.ts).error = true;
      break;
    }
    case "console": {
      pushConsole({ ts: ev.ts, level: p.level as ConsoleLevel, args: (p.args as string[]) || [] });
      break;
    }
  }
}

// ---- sources ----
export function refreshSources(cb: () => void): void {
  chrome.devtools.inspectedWindow.getResources((resources) => {
    const metas: SourceMeta[] = [];
    let pending = 0;
    const MAX_CONTENT = 200;
    const finish = () => {
      store.sources = metas;
      cb();
      notify();
    };
    resources.slice(0, 500).forEach((res, i) => {
      const url = res.url || "";
      if (!url || url.startsWith("chrome-extension:")) return;
      const meta: SourceMeta = {
        url,
        type: (res as unknown as { type?: string }).type || "other",
        size: -1,
        thirdParty: !sameBase(url, store.pageOrigin),
      };
      metas.push(meta);
      if (i < MAX_CONTENT) {
        pending++;
        try {
          res.getContent((content) => {
            if (content) {
              meta.size = content.length;
              if (!meta.thirdParty && (meta.type === "script" || meta.type === "document")) {
                meta.contentSample = content.slice(0, 200_000);
              }
            }
            if (--pending === 0) finish();
          });
        } catch {
          if (--pending === 0) finish();
        }
      }
    });
    if (pending === 0) finish();
  });
}

function sameBase(url: string, origin: string): boolean {
  try {
    const a = new URL(url).hostname.split(".").slice(-2).join(".");
    const b = new URL(origin || "http://x").hostname.split(".").slice(-2).join(".");
    return a === b;
  } catch {
    return false;
  }
}
