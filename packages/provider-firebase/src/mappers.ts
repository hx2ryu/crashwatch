import type { CrashEvent, Issue, ReportRow } from "@crashwatch/core";

/**
 * BigQuery returns dates as Date-like objects with `.value` ISO strings;
 * normalize to ISO string without importing the BigQuery type.
 */
function toIso(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "value" in (v as object)) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

function toInt(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === "bigint") return Number(v);
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return undefined;
}

export interface BqIssueRow {
  issue_id: string;
  issue_title?: string | null;
  issue_subtitle?: string | null;
  events: unknown;
  impacted_users?: unknown;
  fatal_events?: unknown;
  first_seen?: unknown;
  last_seen?: unknown;
  last_seen_version?: string | null;
}

export function rowToIssue(row: BqIssueRow): {
  issue: Issue;
  events: number;
  impactedUsers: number;
} {
  const fatal = toInt(row.fatal_events) ?? 0;
  const events = toInt(row.events) ?? 0;
  return {
    issue: {
      id: row.issue_id,
      title: row.issue_title ?? "(untitled)",
      subtitle: row.issue_subtitle ?? undefined,
      errorType: fatal > 0 ? "fatal" : "non_fatal",
      state: "open",
      firstSeen: toIso(row.first_seen),
      lastSeen: toIso(row.last_seen),
      lastSeenVersion: row.last_seen_version ?? undefined,
      raw: row,
    },
    events,
    impactedUsers: toInt(row.impacted_users) ?? 0,
  };
}

export interface BqEventRow {
  event_id?: string;
  event_timestamp?: unknown;
  issue_id: string;
  is_fatal?: unknown;
  app_version?: string | null;
  device_manufacturer?: string | null;
  device_model?: string | null;
  os_version?: string | null;
  os_name?: string | null;
  exceptions?: unknown;
  breadcrumbs?: unknown;
  blame_frame?: unknown;
  memory_used?: unknown;
  disk_used?: unknown;
}

export function rowToEvent(row: BqEventRow): CrashEvent {
  return {
    id: row.event_id ?? `${row.issue_id}:${toIso(row.event_timestamp) ?? "?"}`,
    issueId: row.issue_id,
    occurredAt: toIso(row.event_timestamp) ?? "",
    appVersion: row.app_version ?? undefined,
    device: row.device_manufacturer || row.device_model
      ? {
          manufacturer: row.device_manufacturer ?? undefined,
          model: row.device_model ?? undefined,
        }
      : undefined,
    os: row.os_name || row.os_version
      ? { name: row.os_name ?? undefined, version: row.os_version ?? undefined }
      : undefined,
    memory: row.memory_used != null ? { used: toInt(row.memory_used) } : undefined,
    stackFrames: blameToFrames(row.blame_frame),
    breadcrumbs: breadcrumbsFrom(row.breadcrumbs),
    raw: row,
  };
}

function blameToFrames(blame: unknown): CrashEvent["stackFrames"] {
  if (!blame || typeof blame !== "object") return undefined;
  const b = blame as Record<string, unknown>;
  return [
    {
      library: typeof b.library === "string" ? b.library : undefined,
      address: typeof b.address === "string" ? b.address : undefined,
      symbol: typeof b.symbol === "string" ? b.symbol : undefined,
      file: typeof b.file === "string" ? b.file : undefined,
      line: toInt(b.line),
    },
  ];
}

function breadcrumbsFrom(bcs: unknown): CrashEvent["breadcrumbs"] {
  if (!Array.isArray(bcs)) return undefined;
  return bcs
    .map((bc): NonNullable<CrashEvent["breadcrumbs"]>[number] | null => {
      if (!bc || typeof bc !== "object") return null;
      const b = bc as Record<string, unknown>;
      return {
        timestamp: toIso(b.timestamp),
        name: typeof b.name === "string" ? b.name : undefined,
        data: b.data,
      };
    })
    .filter((x): x is NonNullable<CrashEvent["breadcrumbs"]>[number] => x !== null);
}

export interface BqReportRow {
  dimension: string;
  events: unknown;
  impacted_users?: unknown;
}

export function rowToReport(row: BqReportRow): ReportRow {
  return {
    dimension: row.dimension,
    events: toInt(row.events) ?? 0,
    impactedUsers: toInt(row.impacted_users),
  };
}
