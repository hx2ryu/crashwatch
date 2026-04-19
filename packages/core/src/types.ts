/**
 * Vendor-neutral crash observability types.
 *
 * These types model the common denominator across providers (Firebase
 * Crashlytics, Sentry, Bugsnag, Rollbar, etc.). Providers map their native
 * responses into these shapes; everything downstream (detection, storage,
 * notification) operates only on these types.
 */

/** Reference to an app as defined in config. Opaque to providers. */
export interface AppRef {
  /** User-facing app name, unique within the config. */
  name: string;
  /** Platform this app instance runs on. */
  platform: Platform;
  /** Provider-specific identifiers (appId, projectId, etc.). */
  providerOptions: Record<string, unknown>;
}

export type Platform = "android" | "ios" | "web" | "backend" | "other";

export type ErrorType = "fatal" | "non_fatal" | "anr" | "unknown";

/** One tracked issue (de-duplicated group of crashes). */
export interface Issue {
  /** Provider-assigned stable ID. */
  id: string;
  /** Human title (e.g. the top stack frame). */
  title: string;
  subtitle?: string;
  errorType: ErrorType;
  state: "open" | "closed" | "muted" | "unknown";
  firstSeen?: string;
  lastSeen?: string;
  firstSeenVersion?: string;
  lastSeenVersion?: string;
  /** Canonical URL in the provider's console. */
  url?: string;
  /** Provider-labelled signals (e.g. regressed, fresh, early). */
  signals?: string[];
  /**
   * Events attributed to this issue within the recent window (as defined by
   * the provider; typically 24 h). Providers that can compute this cheaply
   * (e.g. via BigQuery aggregate) should populate it so the runner does not
   * have to do an N+1 follow-up query per issue.
   */
  recentEvents?: number;
  /** Distinct impacted users within the same window. */
  recentImpactedUsers?: number;
  /** Original provider payload for debugging; not schema-stable. */
  raw?: unknown;
}

/** Detail view of an issue including a sample event (stack + breadcrumbs). */
export interface IssueDetail extends Issue {
  sampleEvent?: CrashEvent;
  variants?: Array<{ id: string; url?: string }>;
}

/** A single crash occurrence. */
export interface CrashEvent {
  id: string;
  issueId: string;
  occurredAt: string;
  appVersion?: string;
  device?: { manufacturer?: string; model?: string; marketingName?: string };
  os?: { name?: string; version?: string };
  stackFrames?: StackFrame[];
  breadcrumbs?: Array<{ timestamp?: string; name?: string; data?: unknown }>;
  memory?: { used?: number; free?: number };
  raw?: unknown;
}

export interface StackFrame {
  symbol?: string;
  file?: string;
  line?: number;
  column?: number;
  library?: string;
  address?: string;
}

/** Counts over a time window. */
export interface MetricsWindow {
  windowStart: string;
  windowEnd: string;
  events: number;
  impactedUsers?: number;
}

/** Immutable point-in-time capture of an app's crash state. */
export interface Snapshot {
  capturedAt: string;
  appName: string;
  platform: Platform;
  /** Per-issue metrics over the default window. */
  issues: Array<{
    issue: Issue;
    recent: MetricsWindow;
    /** Optional reference window (e.g. same period prior week). */
    baseline?: MetricsWindow;
  }>;
  /** Aggregate metrics if the provider exposes them. */
  aggregate?: {
    crashFreeUsersRate?: number;
    topVersions?: Array<{ version: string; events: number }>;
  };
}

/** An alert emitted by the detector; dispatched to notifiers. */
export interface Alert {
  id: string;
  level: "info" | "warning" | "critical";
  kind:
    | "new_issue"
    | "regression"
    | "spike"
    | "resurfaced"
    | "sla_breach"
    | "custom";
  title: string;
  summary: string;
  appName: string;
  platform: Platform;
  issue?: Issue;
  links?: Array<{ label: string; url: string }>;
  emittedAt: string;
  /** Arbitrary rule-specific payload for notifier templating. */
  context?: Record<string, unknown>;
}

/** Filter passed into provider list* methods. */
export interface IssueFilter {
  from?: string;
  to?: string;
  errorTypes?: ErrorType[];
  signals?: string[];
  /** Max number of issues to return; provider may cap lower. */
  limit?: number;
  /** Opaque provider-specific cursor for pagination. */
  pageToken?: string;
}

export interface EventFilter extends IssueFilter {
  issueId?: string;
  versionDisplayNames?: string[];
  deviceFormFactors?: Array<"PHONE" | "TABLET" | "DESKTOP" | "TV" | "WATCH">;
}

export type ReportKind =
  | "topIssues"
  | "topVersions"
  | "topDevices"
  | "topOperatingSystems";

export interface ReportRow {
  dimension: string;
  events: number;
  impactedUsers?: number;
}
