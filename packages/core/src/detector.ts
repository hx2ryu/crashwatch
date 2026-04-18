import type { Alert, Snapshot } from "./types.js";
import type { Thresholds } from "./config.js";

/**
 * Compare a current snapshot against historical snapshots and emit alerts.
 *
 * MVP rules:
 *   1. `new_issue` — issue id absent from any snapshot in the last 7 days
 *      and has >= thresholds.newIssueEvents24h events in the current window.
 *   2. `spike`     — events grew by >= thresholds.regressionPct vs the
 *      same-weekday baseline (if present in history).
 *   3. `regression` — issue carries any signal in thresholds.regressionSignals.
 *
 * Plug your own rules by implementing the same detector signature.
 */
export type Detector = (
  current: Snapshot,
  history: Snapshot[],
  thresholds: Thresholds,
) => Alert[];

export const defaultDetector: Detector = (current, history, t) => {
  const alerts: Alert[] = [];
  const knownIssueIds = new Set<string>();
  for (const snap of history) {
    for (const entry of snap.issues) knownIssueIds.add(entry.issue.id);
  }

  const baselineByIssueId = weekOldBaseline(current, history);

  for (const { issue, recent } of current.issues) {
    // 3. Regression signal trumps everything.
    const hasRegressionSignal = (issue.signals ?? []).some((s) =>
      t.regressionSignals.includes(s),
    );
    if (hasRegressionSignal) {
      alerts.push(
        alert("regression", "warning", issue.title, current, issue, {
          reason: `Provider signal(s): ${(issue.signals ?? []).join(", ")}`,
          events: recent.events,
        }),
      );
    }

    // 1. New issue.
    if (
      !knownIssueIds.has(issue.id) &&
      recent.events >= t.newIssueEvents24h
    ) {
      alerts.push(
        alert("new_issue", "warning", issue.title, current, issue, {
          events24h: recent.events,
          threshold: t.newIssueEvents24h,
        }),
      );
      continue; // no point evaluating spike on brand-new issues
    }

    // 2. Spike vs last-week baseline.
    const baseline = baselineByIssueId.get(issue.id);
    if (baseline && baseline.events > 0) {
      const pct = ((recent.events - baseline.events) / baseline.events) * 100;
      if (pct >= t.regressionPct) {
        alerts.push(
          alert("spike", "critical", issue.title, current, issue, {
            events: recent.events,
            baselineEvents: baseline.events,
            deltaPct: Math.round(pct * 10) / 10,
          }),
        );
      }
    }
  }

  return alerts;
};

function weekOldBaseline(
  current: Snapshot,
  history: Snapshot[],
): Map<string, { events: number }> {
  const now = Date.parse(current.capturedAt);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const tolerance = 12 * 60 * 60 * 1000;
  const candidate = history
    .map((s) => ({ s, diff: Math.abs(now - Date.parse(s.capturedAt) - weekMs) }))
    .filter((c) => c.diff < tolerance)
    .sort((a, b) => a.diff - b.diff)[0];
  const out = new Map<string, { events: number }>();
  if (!candidate) return out;
  for (const { issue, recent } of candidate.s.issues) {
    out.set(issue.id, { events: recent.events });
  }
  return out;
}

function alert(
  kind: Alert["kind"],
  level: Alert["level"],
  title: string,
  current: Snapshot,
  issue: Alert["issue"],
  context: Record<string, unknown>,
): Alert {
  return {
    id: `${current.appName}:${issue?.id ?? "_"}:${kind}:${current.capturedAt}`,
    level,
    kind,
    title: `[${current.appName}] ${kindLabel(kind)} — ${title}`,
    summary: summarize(kind, context),
    appName: current.appName,
    platform: current.platform,
    issue,
    links: issue?.url ? [{ label: "Console", url: issue.url }] : [],
    emittedAt: new Date().toISOString(),
    context,
  };
}

function kindLabel(kind: Alert["kind"]): string {
  switch (kind) {
    case "new_issue":
      return "New issue";
    case "regression":
      return "Regressed";
    case "spike":
      return "Spike";
    case "resurfaced":
      return "Resurfaced";
    case "sla_breach":
      return "SLA breach";
    default:
      return "Custom";
  }
}

function summarize(
  kind: Alert["kind"],
  ctx: Record<string, unknown>,
): string {
  switch (kind) {
    case "spike":
      return `Events ${ctx.baselineEvents} → ${ctx.events} (${ctx.deltaPct}% vs last week).`;
    case "new_issue":
      return `${ctx.events24h} events in 24h (threshold ${ctx.threshold}).`;
    case "regression":
      return String(ctx.reason ?? "Provider flagged this issue as regressed.");
    default:
      return JSON.stringify(ctx);
  }
}
