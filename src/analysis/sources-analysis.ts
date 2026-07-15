import type { Finding, SourceMeta } from "../shared/types";
import { SECRET_VALUE_PATTERNS } from "./privacy-lists";
import { fmtBytes } from "./util";

const LARGE_BUNDLE = 1024 * 1024; // 1 MB

export function analyzeSources(sources: SourceMeta[]): Finding[] {
  const findings: Finding[] = [];
  if (sources.length === 0) return findings;

  // ---- inventory summary ----
  const byType = new Map<string, { count: number; size: number }>();
  let thirdPartyCount = 0;
  for (const s of sources) {
    const t = byType.get(s.type) || { count: 0, size: 0 };
    t.count++;
    if (s.size > 0) t.size += s.size;
    byType.set(s.type, t);
    if (s.thirdParty) thirdPartyCount++;
  }
  const inv = [...byType.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([t, v]) => `${t}: ${v.count} (${fmtBytes(v.size)})`)
    .join(", ");
  findings.push({
    severity: "info",
    category: "sources",
    title: `${sources.length} resources loaded (${thirdPartyCount} third-party)`,
    detail: inv,
  });

  // ---- large scripts ----
  for (const s of sources) {
    if (s.type === "script" && s.size >= LARGE_BUNDLE) {
      findings.push({
        severity: "warn",
        category: "sources",
        title: `Large script: ${fmtBytes(s.size)}`,
        detail: `${s.url} — consider code-splitting or lazy loading.`,
        refs: [s.url],
      });
    }
  }

  // ---- duplicate-sized scripts (likely double-loaded bundles) ----
  const bySize = new Map<number, string[]>();
  for (const s of sources) {
    if (s.type !== "script" || s.size <= 10_000) continue;
    const arr = bySize.get(s.size) || [];
    arr.push(s.url);
    bySize.set(s.size, arr);
  }
  for (const [size, urls] of bySize) {
    if (urls.length >= 2) {
      findings.push({
        severity: "info",
        category: "sources",
        title: "Possible duplicate script payloads",
        detail: `${urls.length} scripts have identical size (${fmtBytes(size)}) — the same bundle may load twice under different URLs.`,
        refs: urls.slice(0, 4),
      });
    }
  }

  // ---- secret scan over first-party samples ----
  for (const s of sources) {
    if (!s.contentSample || s.thirdParty) continue;
    for (const p of SECRET_VALUE_PATTERNS) {
      const m = s.contentSample.match(p.re);
      if (m) {
        findings.push({
          severity: "issue",
          category: "sources",
          title: `${p.name} in page source`,
          detail: `Credential-shaped value ("${m[0].slice(0, 24)}…") found in ${s.url}. Anything shipped to the browser is public.`,
          refs: [s.url],
        });
        break;
      }
    }
  }

  return findings;
}
