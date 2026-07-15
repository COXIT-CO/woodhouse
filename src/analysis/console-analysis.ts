import type { ConsoleEntry, Finding, ReqEntry } from "../shared/types";
import { messageSignature } from "./util";

const CORRELATION_WINDOW_MS = 500;

export function analyzeConsole(entries: ConsoleEntry[], requests: ReqEntry[]): Finding[] {
  const findings: Finding[] = [];
  if (entries.length === 0) return findings;

  // ---- group repeated messages ----
  const groups = new Map<string, { level: string; count: number; sample: string }>();
  for (const e of entries) {
    const msg = e.args.join(" ");
    const key = `${e.level}|${messageSignature(msg)}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { level: e.level, count: 1, sample: msg.slice(0, 160) });
  }

  const errors = [...groups.values()].filter((g) => g.level === "error" || g.level === "uncaught" || g.level === "unhandledrejection");
  const warns = [...groups.values()].filter((g) => g.level === "warn");

  for (const g of errors) {
    findings.push({
      severity: "issue",
      category: "console",
      title: g.count > 1 ? `Error repeated ${g.count}×` : "Console error",
      detail: g.sample,
    });
  }
  const noisy = [...groups.values()].filter((g) => g.count >= 20 && g.level !== "error");
  for (const g of noisy) {
    findings.push({
      severity: "info",
      category: "console",
      title: `Noisy ${g.level}: ${g.count} repetitions`,
      detail: `"${g.sample}" — repeated logging hurts performance and drowns real errors.`,
    });
  }
  if (warns.length > 10) {
    findings.push({
      severity: "info",
      category: "console",
      title: `${warns.length} distinct warning types`,
      detail: "High warning diversity often hides deprecations that will break on a browser update.",
    });
  }

  // ---- correlate console errors with failed requests ----
  const failed = requests.filter((r) => r.status >= 400);
  const errorEntries = entries.filter((e) => e.level === "error" || e.level === "uncaught" || e.level === "unhandledrejection");
  const correlated = new Set<string>();
  for (const err of errorEntries) {
    for (const r of failed) {
      const end = r.startedAt + r.time;
      if (Math.abs(err.ts - end) <= CORRELATION_WINDOW_MS) {
        const key = `${r.url}|${messageSignature(err.args.join(" "))}`;
        if (correlated.has(key)) continue;
        correlated.add(key);
        findings.push({
          severity: "issue",
          category: "console",
          title: `Console error correlates with HTTP ${r.status}`,
          detail: `"${err.args.join(" ").slice(0, 120)}" fired within ${CORRELATION_WINDOW_MS}ms of ${r.method} ${r.url} → ${r.status}. Likely cause & effect.`,
          refs: [r.url],
        });
      }
    }
  }

  return findings;
}
