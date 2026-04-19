import type {
  AppRef,
  CrashEvent,
  CrashProvider,
  EventFilter,
  Issue,
  IssueDetail,
  IssueFilter,
  ProviderCapability,
  ProviderFactory,
  ReportKind,
  ReportRow,
} from "@crashwatch/core";

import {
  createBigqueryClient,
  type BigqueryClient,
  type BigqueryClientOptions,
} from "./bigquery.js";
import {
  rowToEvent,
  rowToIssue,
  rowToReport,
  type BqEventRow,
  type BqIssueRow,
  type BqReportRow,
} from "./mappers.js";
import {
  GET_ISSUE_SQL,
  LIST_EVENTS_SQL,
  LIST_ISSUES_SQL,
  TOP_DEVICES_SQL,
  TOP_OS_SQL,
  TOP_VERSIONS_SQL,
  assertValidTableId,
  renderTable,
} from "./sql.js";

/**
 * Firebase Crashlytics provider backed by the official BigQuery export.
 *
 * Firebase does not expose a stable public REST API for listing issues or
 * events. The only officially supported machine-readable source is the
 * Crashlytics → BigQuery export. This provider therefore requires the
 * export to be configured on your Firebase project.
 *
 * Setup reference:
 *   https://firebase.google.com/docs/crashlytics/bigquery-export
 *
 * Per-app config:
 *   apps:
 *     - name: example-app
 *       platforms:
 *         android:
 *           providerOptions:
 *             bigqueryTable: "my-project.firebase_crashlytics.example_app_ANDROID"
 */
export interface FirebaseProviderOptions extends BigqueryClientOptions {
  /** Default time window, in hours, for list* methods that lack from/to. */
  defaultWindowHours?: number;
}

export interface FirebaseAppProviderOptions {
  /** Fully-qualified BigQuery table, "<project>.<dataset>.<table>". */
  bigqueryTable: string;
}

const DEFAULT_WINDOW_HOURS = 24;

const createFirebaseProvider: ProviderFactory<FirebaseProviderOptions> = async (
  options,
) => {
  const client = await createBigqueryClient(options);
  return new FirebaseProvider(client, options);
};

export default createFirebaseProvider;
export { createFirebaseProvider };
export type { BigqueryClient } from "./bigquery.js";

export class FirebaseProvider implements CrashProvider {
  readonly id = "firebase-crashlytics";

  constructor(
    private readonly bq: BigqueryClient,
    private readonly options: FirebaseProviderOptions,
  ) {}

  supports(capability: ProviderCapability): boolean {
    return (
      capability === "listIssues" ||
      capability === "listEvents" ||
      capability === "getReport"
    );
  }

  async listIssues(app: AppRef, filter: IssueFilter): Promise<Issue[]> {
    const table = tableFor(app);
    const { from, to } = this.window(filter);
    const rows = await this.bq.query(
      renderTable(LIST_ISSUES_SQL, table),
      { from, to, limit: filter.limit ?? 20 },
      { from: "TIMESTAMP", to: "TIMESTAMP", limit: "INT64" },
    );
    return rows.map((r) => {
      const { issue, events, impactedUsers } = rowToIssue(
        r as unknown as BqIssueRow,
      );
      return { ...issue, recentEvents: events, recentImpactedUsers: impactedUsers };
    });
  }

  async getIssue(app: AppRef, issueId: string): Promise<IssueDetail> {
    const table = tableFor(app);
    const { from, to } = this.window({});
    const [issueRow] = await this.bq.query(
      renderTable(GET_ISSUE_SQL, table),
      { from, to, issueId },
      { from: "TIMESTAMP", to: "TIMESTAMP", issueId: "STRING" },
    );
    if (!issueRow) {
      return {
        id: issueId,
        title: "(not found in window)",
        errorType: "unknown",
        state: "unknown",
      };
    }
    const { issue } = rowToIssue(issueRow as unknown as BqIssueRow);
    const [sampleRow] = await this.bq.query(
      renderTable(LIST_EVENTS_SQL, table).replace("{ISSUE_FILTER}", "AND issue_id = @issueId"),
      { from, to, issueId, limit: 1 },
      {
        from: "TIMESTAMP",
        to: "TIMESTAMP",
        issueId: "STRING",
        limit: "INT64",
      },
    );
    return {
      ...issue,
      sampleEvent: sampleRow ? rowToEvent(sampleRow as unknown as BqEventRow) : undefined,
    };
  }

  async listEvents(app: AppRef, filter: EventFilter): Promise<CrashEvent[]> {
    const table = tableFor(app);
    const { from, to } = this.window(filter);
    const params: Record<string, unknown> = {
      from,
      to,
      limit: filter.limit ?? 100,
    };
    const types: Record<string, string> = {
      from: "TIMESTAMP",
      to: "TIMESTAMP",
      limit: "INT64",
    };
    let issueFilter = "";
    if (filter.issueId) {
      issueFilter = "AND issue_id = @issueId";
      params.issueId = filter.issueId;
      types.issueId = "STRING";
    }
    const rows = await this.bq.query(
      renderTable(LIST_EVENTS_SQL, table).replace("{ISSUE_FILTER}", issueFilter),
      params,
      types,
    );
    return rows.map((r) => rowToEvent(r as unknown as BqEventRow));
  }

  async getReport(
    app: AppRef,
    kind: ReportKind,
    filter: EventFilter,
  ): Promise<ReportRow[]> {
    const table = tableFor(app);
    const { from, to } = this.window(filter);
    const tpl = reportTemplate(kind);
    if (!tpl) return [];
    const rows = await this.bq.query(
      renderTable(tpl, table),
      { from, to, limit: filter.limit ?? 10 },
      { from: "TIMESTAMP", to: "TIMESTAMP", limit: "INT64" },
    );
    return rows.map((r) => rowToReport(r as unknown as BqReportRow));
  }

  private window(filter: { from?: string; to?: string }): {
    from: string;
    to: string;
  } {
    const to = filter.to ?? new Date().toISOString();
    const hours = this.options.defaultWindowHours ?? DEFAULT_WINDOW_HOURS;
    const from =
      filter.from ?? new Date(Date.parse(to) - hours * 3600_000).toISOString();
    return { from, to };
  }
}

function tableFor(app: AppRef): string {
  const opts = app.providerOptions as Partial<FirebaseAppProviderOptions>;
  const table = opts.bigqueryTable;
  if (!table) {
    throw new Error(
      `App "${app.name}" (${app.platform}) is missing providerOptions.bigqueryTable ` +
        `for @crashwatch/provider-firebase.`,
    );
  }
  assertValidTableId(table);
  return table;
}

function reportTemplate(kind: ReportKind): string | null {
  switch (kind) {
    case "topVersions":
      return TOP_VERSIONS_SQL;
    case "topDevices":
      return TOP_DEVICES_SQL;
    case "topOperatingSystems":
      return TOP_OS_SQL;
    case "topIssues":
      return null; // already covered by listIssues — callers should prefer that
    default:
      return null;
  }
}
