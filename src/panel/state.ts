import type { AnalysisResult, ConsoleEntry, ReqEntry, SourceMeta, WsConn } from "../shared/types";

export const CAPS = {
  requests: 5000,
  consoleEntries: 5000,
  framesPerConn: 1000,
};

export interface Store {
  requests: ReqEntry[];
  wsConns: Map<number, WsConn>;
  sseConns: Map<number, WsConn>; // reuse shape; frames are messages
  consoleEntries: ConsoleEntry[];
  sources: SourceMeta[];
  analysis: AnalysisResult | null;
  preserveLog: boolean;
  eventsDropped: number;
  pageOrigin: string;
}

export const store: Store = {
  requests: [],
  wsConns: new Map(),
  sseConns: new Map(),
  consoleEntries: [],
  sources: [],
  analysis: null,
  preserveLog: false,
  eventsDropped: 0,
  pageOrigin: "",
};

let nextReqId = 1;
export const newReqId = () => nextReqId++;

export function clearStore(): void {
  store.requests = [];
  store.wsConns = new Map();
  store.sseConns = new Map();
  store.consoleEntries = [];
  store.sources = [];
  store.analysis = null;
  store.eventsDropped = 0;
  notify();
}

export function pushRequest(r: ReqEntry): void {
  store.requests.push(r);
  if (store.requests.length > CAPS.requests) store.requests.splice(0, store.requests.length - CAPS.requests);
  notify();
}

export function pushConsole(e: ConsoleEntry): void {
  store.consoleEntries.push(e);
  if (store.consoleEntries.length > CAPS.consoleEntries)
    store.consoleEntries.splice(0, store.consoleEntries.length - CAPS.consoleEntries);
  notify();
}

// ---- change notification (throttled via rAF) ----
type Listener = () => void;
const listeners = new Set<Listener>();
let scheduled = false;

export function subscribe(fn: Listener): void {
  listeners.add(fn);
}

export function notify(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) fn();
  });
}
