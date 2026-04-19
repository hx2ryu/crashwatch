import type { Alert, Issue, Snapshot } from "./types.js";
import type { Thresholds } from "./config.js";

/**
 * Compare a current snapshot against historical snapshots and emit alerts.
 *
 * MVP rules:
 *   1. `new_issue`   — issue id absent from any snapshot in the last 7 days
 *      and has >= thresholds.newIssueEvents24h events in the current window.
 *   2. `spike`       — events grew by >= thresholds.regressionPct vs a
 *      baseline. Two baseline paths are considered:
 *        a) same-weekday snapshot in history (week-over-week)
 *        b) latest history snapshot where the same issue was last seen on a
 *           strictly-older `lastSeenVersion` (prior-release)
 *      If both baselines would fire, only the one with the larger percent
 *      delta is emitted.
 *   3. `regression`  — issue carries any signal in thresholds.regressionSignals.
 *   4. `resurfaced`  — a historical snapshot showed this issue as "closed"
 *      (resolved) and the current window has events > 0. Suppressed if the
 *      same issue also qualifies for `regression`.
 *
 * Plug your own rules by implementing the same detector signature.
 */
export type Detector = (
  current: Snapshot,
  history: Snapshot[],
  thresholds: Thresholds,
) => Alert[];

/**
 * Factory signature for pluggable detectors. A plugin default-exports one of
 * these (or exports it as `createPlugin`). The CLI resolves the reference in
 * `config.detector` at runtime and calls it with the user-provided options.
 *
 * Returning `defaultDetector` wholesale is a valid implementation — use it as
 * a base and compose extra rules via a thin wrapper.
 */
export type DetectorFactory<TOptions = unknown> = (
  options: TOptions,
) => Detector | Promise<Detector>;

type SpikeBaselineSource = "week_over_week" | "prior_release";

interface SpikeCandidate {
  baselineEvents: number;
  deltaPct: number;
  baselineSource: SpikeBaselineSource;
  baselineVersion?: string;
}

export const defaultDetector: Detector = (current, history, t) => {
  const alerts: Alert[] = [];
  const knownIssueIds = new Set<string>();
  for (const snap of history) {
    for (const entry of snap.issues) knownIssueIds.add(entry.issue.id);
  }

  const baselineByIssueId = weekOldBaseline(current, history);
  const resolvedIssueIds = resolvedInHistory(history);

  for (const { issue, recent } of current.issues) {
    // 3. Regression signal trumps everything (including resurfaced).
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

    // 4. Resurfaced — previously resolved, now emitting events again.
    // Skip if regression already fired (regression wins).
    if (
      !hasRegressionSignal &&
      resolvedIssueIds.has(issue.id) &&
      recent.events > 0
    ) {
      alerts.push(
        alert("resurfaced", "warning", issue.title, current, issue, {
          events: recent.events,
        }),
      );
    }

    // 2. Spike — compare against the strongest available baseline.
    const candidates: SpikeCandidate[] = [];

    const wow = baselineByIssueId.get(issue.id);
    if (wow && wow.events > 0) {
      const pct = ((recent.events - wow.events) / wow.events) * 100;
      if (pct >= t.regressionPct) {
        candidates.push({
          baselineEvents: wow.events,
          deltaPct: Math.round(pct * 10) / 10,
          baselineSource: "week_over_week",
        });
      }
    }

    const prior = priorReleaseBaseline(issue, history);
    if (prior && prior.events > 0) {
      const pct = ((recent.events - prior.events) / prior.events) * 100;
      if (pct >= t.regressionPct) {
        candidates.push({
          baselineEvents: prior.events,
          deltaPct: Math.round(pct * 10) / 10,
          baselineSource: "prior_release",
          baselineVersion: prior.version,
        });
      }
    }

    if (candidates.length > 0) {
      // Pick the baseline with the largest percent delta — the stronger signal.
      const best = candidates.reduce((a, b) =>
        b.deltaPct > a.deltaPct ? b : a,
      );
      const context: Record<string, unknown> = {
        events: recent.events,
        baselineEvents: best.baselineEvents,
        deltaPct: best.deltaPct,
        baselineSource: best.baselineSource,
      };
      if (best.baselineVersion !== undefined) {
        context.baselineVersion = best.baselineVersion;
      }
      alerts.push(
        alert("spike", "critical", issue.title, current, issue, context),
      );
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

/** Set of issue ids that appeared as `closed` (resolved) in any history snapshot. */
function resolvedInHistory(history: Snapshot[]): Set<string> {
  const out = new Set<string>();
  for (const snap of history) {
    for (const { issue } of snap.issues) {
      if (issue.state === "closed") out.add(issue.id);
    }
  }
  return out;
}

/**
 * Find the latest history snapshot where the same issue was last seen on a
 * strictly-older `lastSeenVersion`. Plain string comparison — adequate for
 * monotonic version strings like "1.2.3" vs "1.2.4"; future nice-to-have:
 * swap in a semver-aware comparator.
 */
function priorReleaseBaseline(
  currentIssue: Issue,
  history: Snapshot[],
): { events: number; version: string } | undefined {
  const currentVersion = currentIssue.lastSeenVersion;
  if (!currentVersion) return undefined;

  // Iterate newest-to-oldest so we return the LATEST matching snapshot.
  const ordered = [...history].sort(
    (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
  );
  for (const snap of ordered) {
    const entry = snap.issues.find((e) => e.issue.id === currentIssue.id);
    if (!entry) continue;
    const prevVersion = entry.issue.lastSeenVersion;
    if (!prevVersion) continue;
    // Plain string compare — see note above on semver.
    if (prevVersion < currentVersion) {
      return { events: entry.recent.events, version: prevVersion };
    }
  }
  return undefined;
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
    case "spike": {
      const source = ctx.baselineSource === "prior_release"
        ? `prior release ${ctx.baselineVersion ?? ""}`.trim()
        : "last week";
      return `Events ${ctx.baselineEvents} → ${ctx.events} (${ctx.deltaPct}% vs ${source}).`;
    }
    case "new_issue":
      return `${ctx.events24h} events in 24h (threshold ${ctx.threshold}).`;
    case "regression":
      return String(ctx.reason ?? "Provider flagged this issue as regressed.");
    case "resurfaced":
      return `Previously resolved, now emitting again (${ctx.events} events).`;
    default:
      return JSON.stringify(ctx);
  }
}
