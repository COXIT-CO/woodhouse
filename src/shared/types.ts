export interface Header {
  name: string;
  value: string;
}

export interface ReqEntry {
  id: number;
  startedAt: number; // epoch ms
  method: string;
  url: string;
  status: number;
  statusText: string;
  mimeType: string;
  resourceType: string;
  reqHeaders: Header[];
  resHeaders: Header[];
  queryString: Header[];
  postData?: string;
  bodySize: number;
  transferSize: number;
  time: number; // total ms
  fromCache: boolean;
  body?: string; // response body (may be truncated)
  bodyTruncated?: boolean;
  bodyUnavailable?: boolean;
  isBackfilled?: boolean;
}

export interface WsConn {
  id: number;
  url: string;
  protocols?: string | string[];
  openedAt: number;
  closedAt?: number;
  closeCode?: number;
  closeReason?: string;
  error?: boolean;
  frames: WsFrame[];
  framesDropped: number;
}

export interface WsFrame {
  ts: number;
  dir: "in" | "out";
  data: string;
  truncated?: boolean;
  binary?: boolean;
  size: number;
}

export type ConsoleLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "uncaught"
  | "unhandledrejection";

export interface ConsoleEntry {
  ts: number;
  level: ConsoleLevel;
  args: string[];
}

export interface SourceMeta {
  url: string;
  type: string;
  size: number; // -1 unknown
  thirdParty: boolean;
  contentSample?: string; // first N chars of first-party JS/HTML, for secret scan
}

export type Severity = "info" | "warn" | "issue";

export interface Finding {
  severity: Severity;
  category: "security" | "privacy" | "duplicates" | "console" | "sources" | "network";
  title: string;
  detail: string;
  refs?: string[]; // urls or descriptors of offending items
}

/** Events flowing injected -> bridge -> sw -> panel */
export interface WhEvent {
  kind:
    | "ws-open"
    | "ws-frame"
    | "ws-close"
    | "ws-error"
    | "sse-open"
    | "sse-message"
    | "sse-error"
    | "console";
  ts: number;
  payload: Record<string, unknown>;
}

export interface AnalysisInput {
  requests: ReqEntry[];
  wsConns: WsConn[];
  consoleEntries: ConsoleEntry[];
  sources: SourceMeta[];
  pageOrigin: string;
}

export interface AnalysisResult {
  findings: Finding[];
  headerAnnotations: Record<string, string>; // header name (lowercase) -> plain-language meaning
}
