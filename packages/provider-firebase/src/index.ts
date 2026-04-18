import type {
  AppRef,
  CrashEvent,
  CrashProvider,
  EventFilter,
  Issue,
  IssueDetail,
  IssueFilter,
  ProviderFactory,
  ReportKind,
  ReportRow,
} from "@crashwatch/core";

/**
 * Firebase Crashlytics provider.
 *
 * Firebase does not publish a stable public REST API for Crashlytics issue
 * and event data. Two supported modes:
 *
 *   1. "bigquery" (recommended for production) — reads the Crashlytics
 *      BigQuery export. Requires the export to be configured on the Firebase
 *      project. Stable, queryable, and the basis for the dashboards Google
 *      itself ships.
 *
 *   2. "firebase-cli" (for quick setups) — shells out to the Firebase CLI,
 *      which uses Google-internal management APIs. May break across CLI
 *      versions; use with a pinned firebase-tools.
 *
 * This MVP ships mode (2) as a thin adapter and leaves (1) as a clearly
 * marked TODO. Both keep all credential handling inside the plugin so the
 * core is unaware of Firebase specifics.
 */
export interface FirebaseProviderOptions {
  /**
   * Absolute path to a Google service-account key, or the raw contents.
   * When unset, Application Default Credentials are used.
   */
  credentials?: string;
  /** One of "bigquery" | "firebase-cli". */
  mode?: "bigquery" | "firebase-cli";
  /** For bigquery mode: BigQuery dataset fully qualified name. */
  bigqueryDataset?: string;
  /** For firebase-cli mode: absolute path to firebase binary. */
  firebaseBin?: string;
}

const createFirebaseProvider: ProviderFactory<FirebaseProviderOptions> = (
  options,
) => {
  const mode = options.mode ?? "firebase-cli";
  if (mode === "bigquery") {
    return new BigqueryFirebaseProvider(options);
  }
  return new CliFirebaseProvider(options);
};

export default createFirebaseProvider;
export { createFirebaseProvider };

// ---------------------------------------------------------------------------
// firebase-cli mode
// ---------------------------------------------------------------------------

class CliFirebaseProvider implements CrashProvider {
  readonly id = "firebase-crashlytics";

  constructor(private readonly options: FirebaseProviderOptions) {}

  async listIssues(_app: AppRef, _filter: IssueFilter): Promise<Issue[]> {
    // TODO: spawn `firebase crashlytics:issues:list --app <appId> --json`
    // (shape subject to firebase-tools version); parse stdout and map into
    // the vendor-neutral Issue type.
    //
    // Until implemented, this method returns an empty list so the runner
    // can exercise the end-to-end plumbing (config → provider → detector).
    return [];
  }

  async getIssue(_app: AppRef, issueId: string): Promise<IssueDetail> {
    return {
      id: issueId,
      title: "(firebase-cli mode not implemented)",
      errorType: "unknown",
      state: "unknown",
    };
  }

  async listEvents(_app: AppRef, _filter: EventFilter): Promise<CrashEvent[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// bigquery mode
// ---------------------------------------------------------------------------

class BigqueryFirebaseProvider implements CrashProvider {
  readonly id = "firebase-crashlytics";

  constructor(private readonly options: FirebaseProviderOptions) {
    if (!options.bigqueryDataset) {
      throw new Error(
        "bigqueryDataset is required when mode is 'bigquery'. " +
          "Example: 'my-project.firebase_crashlytics.example_app_ANDROID'.",
      );
    }
  }

  async listIssues(_app: AppRef, _filter: IssueFilter): Promise<Issue[]> {
    // TODO: run parameterised SQL against the Crashlytics BQ export, e.g.
    //
    //   SELECT issue_id, issue_title, COUNT(*) events, ...
    //   FROM `dataset.crashlytics_events_...`
    //   WHERE timestamp BETWEEN @from AND @to
    //   GROUP BY issue_id
    //
    // and map each row into the Issue shape. Implementation pending.
    return [];
  }

  async getIssue(_app: AppRef, issueId: string): Promise<IssueDetail> {
    return {
      id: issueId,
      title: "(bigquery mode not implemented)",
      errorType: "unknown",
      state: "unknown",
    };
  }

  async listEvents(_app: AppRef, _filter: EventFilter): Promise<CrashEvent[]> {
    return [];
  }

  async getReport(
    _app: AppRef,
    _kind: ReportKind,
    _filter: EventFilter,
  ): Promise<ReportRow[]> {
    return [];
  }
}
