/** Analysis Web Worker: receives a session snapshot, returns findings. */
import type { AnalysisInput, AnalysisResult, Finding } from "../shared/types";
import { analyzeConsole } from "./console-analysis";
import { findDuplicates } from "./duplicates";
import { analyzeHeaders, HEADER_ANNOTATIONS } from "./headers";
import { analyzeSources } from "./sources-analysis";

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };

ctx.onmessage = (e: MessageEvent) => {
  const input = e.data as AnalysisInput;
  const findings: Finding[] = [];
  try {
    findings.push(...analyzeHeaders(input.requests, input.pageOrigin));
    findings.push(...findDuplicates(input.requests));
    findings.push(...analyzeConsole(input.consoleEntries, input.requests));
    findings.push(...analyzeSources(input.sources));

    // network-level quick wins
    const failed = input.requests.filter((r) => r.status >= 400);
    if (failed.length) {
      const byStatus = new Map<number, number>();
      for (const f of failed) byStatus.set(f.status, (byStatus.get(f.status) || 0) + 1);
      findings.push({
        severity: "issue",
        category: "network",
        title: `${failed.length} failed request(s)`,
        detail: [...byStatus.entries()].map(([s, n]) => `${n}× HTTP ${s}`).join(", "),
        refs: failed.slice(0, 5).map((f) => f.url),
      });
    }
    const slow = input.requests.filter((r) => r.time > 3000 && !r.fromCache);
    for (const s of slow.slice(0, 5)) {
      findings.push({
        severity: "warn",
        category: "network",
        title: `Slow request: ${(s.time / 1000).toFixed(1)}s`,
        detail: `${s.method} ${s.url}`,
        refs: [s.url],
      });
    }
  } catch (err) {
    findings.push({
      severity: "warn",
      category: "network",
      title: "Analysis error",
      detail: String(err),
    });
  }

  const order = { issue: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const result: AnalysisResult = { findings, headerAnnotations: HEADER_ANNOTATIONS };
  ctx.postMessage(result);
};
