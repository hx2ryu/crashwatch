import type {
  AppRef,
  CrashEvent,
  EventFilter,
  Issue,
  IssueDetail,
  IssueFilter,
  ReportKind,
  ReportRow,
} from "./types.js";

/**
 * Adapts a specific crash-reporting backend (Firebase Crashlytics, Sentry,
 * Bugsnag, Rollbar, BigQuery export, ...) into the vendor-neutral core API.
 *
 * Provider implementations are resolved from config by dynamic `import()` of
 * the `plugin` string; the constructor/factory takes provider-scoped options.
 */
export interface CrashProvider {
  /** Stable short id, e.g. "firebase-crashlytics" or "sentry". */
  readonly id: string;

  /** Optional capability check; core skips calls the provider cannot serve. */
  supports?(capability: ProviderCapability): boolean;

  listIssues(app: AppRef, filter: IssueFilter): Promise<Issue[]>;
  getIssue(app: AppRef, issueId: string): Promise<IssueDetail>;
  listEvents(app: AppRef, filter: EventFilter): Promise<CrashEvent[]>;

  /** Numeric reports; not every provider implements every ReportKind. */
  getReport?(
    app: AppRef,
    kind: ReportKind,
    filter: EventFilter,
  ): Promise<ReportRow[]>;
}

export type ProviderCapability =
  | "listIssues"
  | "listEvents"
  | "getReport"
  | "pagination"
  | "signals";

/** Factory signature; each plugin default-exports one of these. */
export type ProviderFactory<TOptions = unknown> = (
  options: TOptions,
) => CrashProvider | Promise<CrashProvider>;
