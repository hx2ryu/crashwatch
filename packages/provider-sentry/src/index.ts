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
} from "@hx2ryu/crashwatch-core";

import { SentryApiClient, type SentryApiOptions } from "./api.js";
import {
  buildIssueDetail,
  sentryEventToCrashEvent,
  sentryIssueToIssue,
  type SentryEvent,
  type SentryIssue,
} from "./mappers.js";

/**
 * Sentry provider backed by the public REST API.
 *
 * Unlike the Firebase provider (which relies on a BigQuery export), Sentry
 * exposes a stable REST surface that carries both event counts AND first-class
 * regression signals — so this provider advertises `pagination` and `signals`
 * capabilities.
 *
 * Auth:
 *   Create a token at https://sentry.io/settings/account/api/auth-tokens/
 *   with scopes `event:read` and `project:read`.
 *
 * Config sample:
 *   providers:
 *     - id: sentry
 *       plugin: "@hx2ryu/crashwatch-provider-sentry"
 *       options:
 *         authToken: "${SENTRY_AUTH_TOKEN}"
 *         org: "my-org"
 *         defaultProject: "my-project"
 *
 *   apps:
 *     - name: example-app
 *       platforms:
 *         android:
 *           providerOptions:
 *             project: "mobile-android"
 *             environment: "production"
 */
export interface SentryProviderOptions
  extends Omit<SentryApiOptions, "authToken"> {
  authToken: string;
  /** Sentry organization slug. Required. Can be overridden per-app. */
  org: string;
  /** Default project slug used when an app doesn't specify one. */
  defaultProject?: string;
  /** Default time window, in hours, for `list*` methods without `from`/`to`. */
  defaultWindowHours?: number;
  /** Page size passed to Sentry. Max 100; default 100. */
  pageSize?: number;
}

export interface SentryAppProviderOptions {
  org?: string;
  project?: string;
  environment?: string;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_EVENT_LIMIT = 100;

const createSentryProvider: ProviderFactory<SentryProviderOptions> = (
  options,
) => {
  const client = new SentryApiClient(options);
  return new SentryProvider(client, options);
};

export default createSentryProvider;
export { createSentryProvider };
export { SentryApiClient } from "./api.js";
export type { SentryEvent, SentryIssue } from "./mappers.js";

export class SentryProvider implements CrashProvider {
  readonly id = "sentry";

  constructor(
    private readonly api: SentryApiClient,
    private readonly options: SentryProviderOptions,
  ) {
    if (!options.org) {
      throw new Error(
        "@hx2ryu/crashwatch-provider-sentry: `org` is required in provider options.",
      );
    }
  }

  supports(capability: ProviderCapability): boolean {
    return (
      capability === "listIssues" ||
      capability === "listEvents" ||
      capability === "pagination" ||
      capability === "signals"
    );
  }

  async listIssues(app: AppRef, filter: IssueFilter): Promise<Issue[]> {
    const { org, project, environment } = this.resolveTarget(app);
    const { from, to } = this.window(filter);
    const query: Record<string, string | number | undefined> = {
      start: from,
      end: to,
      limit: this.pageSize(),
      query: buildQueryString(filter.signals),
      environment,
      sort: "freq",
    };
    const limit = filter.limit ?? DEFAULT_LIST_LIMIT;
    const path = `/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/`;
    const issues: Issue[] = [];
    for await (const raw of this.api.paginate<SentryIssue>(path, query, limit)) {
      issues.push(sentryIssueToIssue(raw, { windowStart: from }));
    }
    return issues;
  }

  async getIssue(app: AppRef, issueId: string): Promise<IssueDetail> {
    const { org } = this.resolveTarget(app);
    const issuePath = `/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/`;
    const raw = await this.api.getOne<SentryIssue>(issuePath);
    if (!raw) {
      return {
        id: issueId,
        title: "(not found)",
        errorType: "unknown",
        state: "unknown",
      };
    }
    const issue = sentryIssueToIssue(raw, {
      windowStart: this.window({}).from,
    });
    const eventsPath = `/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/events/`;
    const [sample] = (
      await this.api.getPage<SentryEvent>(eventsPath, { full: "true", limit: 1 })
    ).items;
    return buildIssueDetail(issue, sample);
  }

  async listEvents(app: AppRef, filter: EventFilter): Promise<CrashEvent[]> {
    const { org, project, environment } = this.resolveTarget(app);
    const { from, to } = this.window(filter);
    const limit = filter.limit ?? DEFAULT_EVENT_LIMIT;
    const events: CrashEvent[] = [];
    if (filter.issueId) {
      const path = `/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(filter.issueId)}/events/`;
      for await (const raw of this.api.paginate<SentryEvent>(
        path,
        { full: "true", start: from, end: to, environment, limit: this.pageSize() },
        limit,
      )) {
        events.push(sentryEventToCrashEvent(raw));
      }
      return events;
    }
    const path = `/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/events/`;
    for await (const raw of this.api.paginate<SentryEvent>(
      path,
      {
        start: from,
        end: to,
        environment,
        full: "true",
        limit: this.pageSize(),
      },
      limit,
    )) {
      events.push(sentryEventToCrashEvent(raw));
    }
    return events;
  }

  private resolveTarget(app: AppRef): {
    org: string;
    project: string;
    environment: string | undefined;
  } {
    const app_ = app.providerOptions as Partial<SentryAppProviderOptions>;
    const org = app_.org ?? this.options.org;
    const project = app_.project ?? this.options.defaultProject;
    if (!project) {
      throw new Error(
        `App "${app.name}" (${app.platform}) is missing providerOptions.project ` +
          "for @hx2ryu/crashwatch-provider-sentry, and no defaultProject is configured.",
      );
    }
    return { org, project, environment: app_.environment };
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

  private pageSize(): number {
    const size = this.options.pageSize ?? DEFAULT_PAGE_SIZE;
    return Math.min(Math.max(size, 1), 100);
  }
}

function buildQueryString(signals: string[] | undefined): string | undefined {
  if (!signals || signals.length === 0) return undefined;
  const tokens: string[] = [];
  if (signals.includes("SIGNAL_REGRESSED")) tokens.push("is:regressed");
  if (signals.includes("SIGNAL_EARLY")) tokens.push("is:unresolved age:-24h");
  return tokens.length ? tokens.join(" ") : undefined;
}
