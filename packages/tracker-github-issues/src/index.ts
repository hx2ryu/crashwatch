import type {
  Alert,
  IssueTracker,
  TicketRef,
  TrackerContext,
  TrackerFactory,
} from "@hx2ryu/crashwatch-core";

import {
  GitHubApiClient,
  GitHubValidationError,
  type GitHubApiOptions,
} from "./api.js";

/**
 * GitHub Issues tracker backed by the public REST API.
 *
 * On each alert, POSTs to `/repos/{owner}/{repo}/issues` with a markdown body
 * assembled from the alert's `title`, `summary`, level, kind, app name,
 * linked resources (if any) and the underlying provider issue URL (if any).
 * The created issue's `html_url` is returned as the ticket URL — downstream
 * storage records it on the alert so future alerts for the same crash issue
 * can be deduplicated by the caller.
 *
 * Auth:
 *   Create a token at https://github.com/settings/tokens with the `repo` scope
 *   (or `public_repo` for public repos only). Fine-grained tokens require
 *   "Issues: Read and write" on the target repository.
 *
 * Config sample:
 *   trackers:
 *     - id: github
 *       plugin: "@hx2ryu/crashwatch-tracker-github-issues"
 *       options:
 *         authToken: "${GITHUB_TOKEN}"
 *         defaultOwner: "my-org"
 *         defaultRepo: "my-app"
 *         labels: ["crash", "crashwatch"]
 *         assignees: ["alice"]
 *
 *   apps:
 *     - name: example-app
 *       trackerOptions:
 *         github:
 *           owner: "my-org"
 *           repo: "example-app-android"
 */
export interface GitHubIssuesTrackerOptions
  extends Omit<GitHubApiOptions, "authToken"> {
  authToken: string;
  /** Default repo owner (user or org). Overridden by per-alert context. */
  defaultOwner?: string;
  /** Default repo name. Overridden by per-alert context. */
  defaultRepo?: string;
  /** Labels applied to every created issue. */
  labels?: string[];
  /** GitHub usernames assigned to every created issue. */
  assignees?: string[];
}

/**
 * Per-alert overrides resolved from `TrackerContext.options`. Any field not
 * supplied falls back to the tracker-level defaults configured at factory
 * time. `owner` + `repo` must be resolvable from one side or the other.
 */
export interface GitHubTrackerAlertOptions {
  owner?: string;
  repo?: string;
  labels?: string[];
  assignees?: string[];
}

interface CreateIssueRequest {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

interface CreateIssueResponse {
  id: number;
  number: number;
  html_url: string;
  state: string;
  title: string;
}

const createGitHubIssuesTracker: TrackerFactory<GitHubIssuesTrackerOptions> = (
  options,
) => {
  const client = new GitHubApiClient(options);
  return new GitHubIssuesTracker(client, options);
};

export default createGitHubIssuesTracker;
export { createGitHubIssuesTracker };
export { createGitHubIssuesTracker as createPlugin };
export {
  GitHubApiClient,
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubValidationError,
} from "./api.js";

export class GitHubIssuesTracker implements IssueTracker {
  readonly id = "github-issues";

  constructor(
    private readonly api: GitHubApiClient,
    private readonly options: GitHubIssuesTrackerOptions,
  ) {}

  async openTicket(
    alert: Alert,
    ctx: TrackerContext,
  ): Promise<TicketRef | null> {
    const { owner, repo, labels, assignees } = this.resolveTarget(ctx);
    const body = buildIssueBody(alert);
    const payload: CreateIssueRequest = {
      title: alert.title,
      body,
    };
    if (labels.length > 0) payload.labels = labels;
    if (assignees.length > 0) payload.assignees = assignees;
    try {
      const created = await this.api.post<CreateIssueResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        payload,
      );
      return {
        id: String(created.number),
        url: created.html_url,
        status: created.state,
      };
    } catch (err) {
      if (err instanceof GitHubValidationError) {
        // Re-throw with the original actionable message; dedup is the caller's
        // responsibility via the ticket URL recorded on the alert.
        throw new Error(
          `@hx2ryu/crashwatch-tracker-github-issues: could not create issue in ` +
            `${owner}/${repo}. ${err.message}`,
        );
      }
      throw err;
    }
  }

  private resolveTarget(ctx: TrackerContext): {
    owner: string;
    repo: string;
    labels: string[];
    assignees: string[];
  } {
    const perAlert = (ctx.options ?? {}) as GitHubTrackerAlertOptions;
    const owner = perAlert.owner ?? this.options.defaultOwner;
    const repo = perAlert.repo ?? this.options.defaultRepo;
    if (!owner || !repo) {
      throw new Error(
        "@hx2ryu/crashwatch-tracker-github-issues: `owner` and `repo` are required. " +
          "Set `defaultOwner` + `defaultRepo` in the tracker options, or pass " +
          "`owner` + `repo` per-alert via the tracker context options. " +
          `Got owner=${owner ?? "<missing>"} repo=${repo ?? "<missing>"}.`,
      );
    }
    return {
      owner,
      repo,
      labels: perAlert.labels ?? this.options.labels ?? [],
      assignees: perAlert.assignees ?? this.options.assignees ?? [],
    };
  }
}

/**
 * Build a simple markdown body for the GitHub issue. Kept intentionally flat —
 * humans tend to rewrite issue descriptions anyway, and overly fancy templating
 * makes the output harder to diff in recordings. The provider's own issue URL
 * is always surfaced prominently so an engineer can jump to the crash trace.
 */
export function buildIssueBody(alert: Alert): string {
  const lines: string[] = [];
  lines.push(`**${alert.summary}**`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| App | \`${alert.appName}\` |`);
  lines.push(`| Platform | \`${alert.platform}\` |`);
  lines.push(`| Kind | \`${alert.kind}\` |`);
  lines.push(`| Level | \`${alert.level}\` |`);
  lines.push(`| Emitted | \`${alert.emittedAt}\` |`);
  if (alert.issue?.id) {
    lines.push(`| Issue ID | \`${alert.issue.id}\` |`);
  }
  if (alert.issue?.url) {
    lines.push(`| Issue URL | ${alert.issue.url} |`);
  }
  if (alert.links && alert.links.length > 0) {
    lines.push("");
    lines.push("### Links");
    for (const link of alert.links) {
      lines.push(`- [${link.label}](${link.url})`);
    }
  }
  lines.push("");
  lines.push("<sub>Opened by crashwatch.</sub>");
  return lines.join("\n");
}
