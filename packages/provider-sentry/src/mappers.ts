/**
 * Map raw Sentry REST API payloads to crashwatch core types.
 *
 * We keep mappers total: an unexpected shape should fall back to safe defaults
 * ("(untitled)", `state: "unknown"`) rather than throw. The detector is robust
 * to sparse data, and tolerating provider drift is cheaper than a tight coupling
 * to Sentry's current response surface.
 */

import type {
  CrashEvent,
  ErrorType,
  Issue,
  IssueDetail,
  StackFrame,
} from "@crashwatch/core";

export interface SentryIssue {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  statusDetails?: Record<string, unknown>;
  firstSeen?: string;
  lastSeen?: string;
  count?: string | number;
  userCount?: number;
  permalink?: string;
  isRegressed?: boolean;
  isUnhandled?: boolean;
  firstRelease?: { shortVersion?: string; version?: string } | null;
  lastRelease?: { shortVersion?: string; version?: string } | null;
  metadata?: { value?: string; function?: string; type?: string; filename?: string };
  platform?: string;
}

export interface SentryEvent {
  id?: string;
  eventID?: string;
  groupID?: string;
  dateCreated?: string;
  dateReceived?: string;
  message?: string;
  platform?: string;
  tags?: Array<{ key: string; value: string }>;
  contexts?: {
    device?: { manufacturer?: string; model?: string; name?: string };
    os?: { name?: string; version?: string };
    app?: { app_version?: string };
  };
  entries?: Array<{ type?: string; data?: unknown }>;
  user?: { id?: string; email?: string; username?: string };
  release?: string;
}

/**
 * Convert a Sentry issue to a core `Issue`.
 *
 * `windowStart` is used to decide whether to attach the `SIGNAL_EARLY` signal:
 * an issue whose `firstSeen` is inside the current window is "new" from the
 * detector's perspective, matching how the BigQuery provider exposes freshness.
 */
export function sentryIssueToIssue(
  s: SentryIssue,
  opts: { windowStart?: string } = {},
): Issue {
  const signals = collectSignals(s, opts.windowStart);
  return {
    id: s.id,
    title: s.title ?? "(untitled)",
    subtitle: s.culprit ?? undefined,
    errorType: inferErrorType(s),
    state: mapStatus(s.status),
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    firstSeenVersion: releaseVersion(s.firstRelease),
    lastSeenVersion: releaseVersion(s.lastRelease),
    url: s.permalink,
    signals: signals.length ? signals : undefined,
    recentEvents: toInt(s.count),
    recentImpactedUsers:
      typeof s.userCount === "number" ? s.userCount : undefined,
    raw: s,
  };
}

/** Sentry issue status → core `Issue.state`. */
export function mapStatus(status: string | undefined): Issue["state"] {
  switch (status) {
    case "unresolved":
      return "open";
    case "resolved":
      return "closed";
    case "ignored":
      return "muted";
    case "reprocessing":
    case undefined:
      return "unknown";
    default:
      return "unknown";
  }
}

function inferErrorType(s: SentryIssue): ErrorType {
  if (s.level === "fatal") return "fatal";
  if (s.isUnhandled === true) return "fatal";
  if (s.level === "error" || s.level === "warning") return "non_fatal";
  if (!s.level) return "unknown";
  return "non_fatal";
}

function releaseVersion(
  r: SentryIssue["firstRelease"] | SentryIssue["lastRelease"],
): string | undefined {
  if (!r) return undefined;
  return r.shortVersion ?? r.version ?? undefined;
}

function collectSignals(
  s: SentryIssue,
  windowStart: string | undefined,
): string[] {
  const out: string[] = [];
  if (s.isRegressed) out.push("SIGNAL_REGRESSED");
  if (windowStart && s.firstSeen) {
    const start = Date.parse(windowStart);
    const first = Date.parse(s.firstSeen);
    if (Number.isFinite(start) && Number.isFinite(first) && first >= start) {
      out.push("SIGNAL_EARLY");
    }
  }
  return out;
}

function toInt(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === "bigint") return Number(v);
  return undefined;
}

/**
 * Convert a Sentry event to a core `CrashEvent`.
 *
 * Sentry events carry exception frames + breadcrumbs inside `entries` keyed by
 * a `type` string; we walk the array and pull out the two we consume.
 */
export function sentryEventToCrashEvent(e: SentryEvent): CrashEvent {
  const id = e.id ?? e.eventID ?? `${e.groupID ?? "_"}:${e.dateCreated ?? "?"}`;
  return {
    id,
    issueId: e.groupID ?? "",
    occurredAt: e.dateCreated ?? e.dateReceived ?? "",
    appVersion: e.contexts?.app?.app_version ?? e.release ?? undefined,
    device: deviceFrom(e),
    os: osFrom(e),
    stackFrames: stackFramesFrom(e),
    breadcrumbs: breadcrumbsFrom(e),
    raw: e,
  };
}

function deviceFrom(e: SentryEvent): CrashEvent["device"] | undefined {
  const d = e.contexts?.device;
  if (!d) return undefined;
  if (!d.manufacturer && !d.model && !d.name) return undefined;
  return {
    manufacturer: d.manufacturer,
    model: d.model,
    marketingName: d.name,
  };
}

function osFrom(e: SentryEvent): CrashEvent["os"] | undefined {
  const o = e.contexts?.os;
  if (!o) return undefined;
  if (!o.name && !o.version) return undefined;
  return { name: o.name, version: o.version };
}

function stackFramesFrom(e: SentryEvent): StackFrame[] | undefined {
  const exception = (e.entries ?? []).find((x) => x?.type === "exception");
  if (!exception) return undefined;
  const data = exception.data as
    | { values?: Array<{ stacktrace?: { frames?: unknown[] } }> }
    | undefined;
  const frames = data?.values?.[0]?.stacktrace?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  // Sentry lists frames oldest → newest; callers usually want crash frame first.
  return [...frames]
    .reverse()
    .map((raw): StackFrame | null => {
      if (!raw || typeof raw !== "object") return null;
      const f = raw as Record<string, unknown>;
      return {
        symbol: strOrUndef(f.function),
        file: strOrUndef(f.filename) ?? strOrUndef(f.abs_path),
        line: numOrUndef(f.lineno),
        column: numOrUndef(f.colno),
        library: strOrUndef(f.package) ?? strOrUndef(f.module),
        address: strOrUndef(f.instruction_addr),
      };
    })
    .filter((x): x is StackFrame => x !== null);
}

function breadcrumbsFrom(e: SentryEvent): CrashEvent["breadcrumbs"] | undefined {
  const entry = (e.entries ?? []).find((x) => x?.type === "breadcrumbs");
  if (!entry) return undefined;
  const data = entry.data as
    | { values?: Array<Record<string, unknown>> }
    | undefined;
  const values = data?.values;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values
    .map((raw): NonNullable<CrashEvent["breadcrumbs"]>[number] | null => {
      if (!raw || typeof raw !== "object") return null;
      const b = raw as Record<string, unknown>;
      return {
        timestamp: strOrUndef(b.timestamp),
        name:
          strOrUndef(b.message) ??
          strOrUndef(b.category) ??
          strOrUndef(b.type),
        data: b.data,
      };
    })
    .filter(
      (x): x is NonNullable<CrashEvent["breadcrumbs"]>[number] => x !== null,
    );
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Build an `IssueDetail` by pairing a mapped issue with an optional sample event. */
export function buildIssueDetail(
  issue: Issue,
  sample?: SentryEvent,
): IssueDetail {
  return {
    ...issue,
    sampleEvent: sample ? sentryEventToCrashEvent(sample) : undefined,
  };
}
