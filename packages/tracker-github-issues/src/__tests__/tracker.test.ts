import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { Alert, TrackerContext } from "@crashwatch/core";

import { GitHubApiClient, type FetchLike } from "../api.js";
import {
  GitHubIssuesTracker,
  buildIssueBody,
  createGitHubIssuesTracker,
  createPlugin,
} from "../index.js";

interface Recorded {
  url: string;
  method: string;
  body: string | undefined;
}

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

function scriptedClient(
  responses: Array<() => Response>,
): { client: GitHubApiClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const make = queue.shift();
    if (!make) throw new Error("scriptedClient: out of scripted responses");
    return make();
  };
  const client = new GitHubApiClient({
    authToken: "t",
    fetchImpl,
    sleep: async () => {},
    random: () => 0,
  });
  return { client, calls };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alrt_1",
    level: "critical",
    kind: "new_issue",
    title: "NullPointerException: Attempt to invoke virtual method",
    summary: "A new fatal crash has appeared in feed.FeedFragment.onResume.",
    appName: "example-app",
    platform: "android",
    issue: {
      id: "4123456789",
      title: "NullPointerException: Attempt to invoke virtual method",
      errorType: "fatal",
      state: "open",
      url: "https://sentry.io/organizations/my-org/issues/4123456789/",
    },
    links: [
      { label: "Crash trace", url: "https://sentry.io/foo" },
      { label: "Runbook", url: "https://wiki.example.com/crashes" },
    ],
    emittedAt: "2026-04-19T10:00:00.000Z",
    ...overrides,
  };
}

function ctx(options: Record<string, unknown> = {}): TrackerContext {
  return { appName: "example-app", options };
}

describe("buildIssueBody", () => {
  test("includes summary, app, platform, kind, level, emitted timestamp", () => {
    const body = buildIssueBody(alert());
    assert.match(body, /A new fatal crash has appeared/);
    assert.match(body, /example-app/);
    assert.match(body, /android/);
    assert.match(body, /new_issue/);
    assert.match(body, /critical/);
    assert.match(body, /2026-04-19T10:00:00\.000Z/);
  });

  test("includes the provider issue URL when present", () => {
    const body = buildIssueBody(alert());
    assert.match(body, /sentry\.io\/organizations\/my-org\/issues\/4123456789/);
  });

  test("renders alert links as a markdown list", () => {
    const body = buildIssueBody(alert());
    assert.match(body, /### Links/);
    assert.match(body, /\[Crash trace\]\(https:\/\/sentry\.io\/foo\)/);
    assert.match(body, /\[Runbook\]\(https:\/\/wiki\.example\.com\/crashes\)/);
  });

  test("omits the Links section when there are none", () => {
    const body = buildIssueBody(alert({ links: [] }));
    assert.ok(!/### Links/.test(body));
  });

  test("omits the provider issue row when there is no issue", () => {
    const body = buildIssueBody(alert({ issue: undefined }));
    assert.ok(!/\| Issue URL \|/.test(body));
    assert.ok(!/\| Issue ID \|/.test(body));
  });

  test("always ends with the crashwatch attribution footer", () => {
    const body = buildIssueBody(alert());
    assert.match(body, /Opened by crashwatch\.<\/sub>$/);
  });
});

describe("GitHubIssuesTracker.openTicket happy path", () => {
  test("POSTs to /repos/{owner}/{repo}/issues with title + body", async () => {
    const created = fixture<{ number: number; html_url: string; state: string }>(
      "issue-created.json",
    );
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
    });
    const ref = await tracker.openTicket(alert(), ctx());
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(
      calls[0]!.url,
      "https://api.github.com/repos/my-org/my-app/issues",
    );
    const sent = JSON.parse(calls[0]!.body ?? "{}") as {
      title: string;
      body: string;
    };
    assert.equal(sent.title, alert().title);
    assert.match(sent.body, /A new fatal crash/);
    assert.ok(ref);
    assert.equal(ref.id, "1337");
    assert.equal(ref.url, "https://github.com/my-org/my-app/issues/1337");
    assert.equal(ref.status, "open");
  });

  test("tracker id is 'github-issues'", async () => {
    const { client } = scriptedClient([]);
    const tracker = new GitHubIssuesTracker(client, { authToken: "t" });
    assert.equal(tracker.id, "github-issues");
  });

  test("includes configured labels and assignees in the body", async () => {
    const created = fixture<object>("issue-created.json");
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
      labels: ["crash", "crashwatch"],
      assignees: ["alice", "bob"],
    });
    await tracker.openTicket(alert(), ctx());
    const sent = JSON.parse(calls[0]!.body ?? "{}") as {
      labels: string[];
      assignees: string[];
    };
    assert.deepEqual(sent.labels, ["crash", "crashwatch"]);
    assert.deepEqual(sent.assignees, ["alice", "bob"]);
  });

  test("omits labels/assignees fields when empty", async () => {
    const created = fixture<object>("issue-created.json");
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
    });
    await tracker.openTicket(alert(), ctx());
    const sent = JSON.parse(calls[0]!.body ?? "{}") as Record<string, unknown>;
    assert.equal("labels" in sent, false);
    assert.equal("assignees" in sent, false);
  });

  test("per-alert context overrides tracker-level owner/repo", async () => {
    const created = fixture<object>("issue-created.json");
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "fallback-repo",
    });
    await tracker.openTicket(
      alert(),
      ctx({ owner: "other-org", repo: "other-repo" }),
    );
    assert.equal(
      calls[0]!.url,
      "https://api.github.com/repos/other-org/other-repo/issues",
    );
  });

  test("per-alert labels override tracker-level labels", async () => {
    const created = fixture<object>("issue-created.json");
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
      labels: ["crash"],
    });
    await tracker.openTicket(alert(), ctx({ labels: ["urgent"] }));
    const sent = JSON.parse(calls[0]!.body ?? "{}") as { labels: string[] };
    assert.deepEqual(sent.labels, ["urgent"]);
  });

  test("encodes owner and repo slugs with spaces / special chars", async () => {
    const created = fixture<object>("issue-created.json");
    const { client, calls } = scriptedClient([() => jsonResponse(created)]);
    const tracker = new GitHubIssuesTracker(client, { authToken: "t" });
    await tracker.openTicket(
      alert(),
      ctx({ owner: "my org", repo: "repo/with slash" }),
    );
    assert.equal(
      calls[0]!.url,
      "https://api.github.com/repos/my%20org/repo%2Fwith%20slash/issues",
    );
  });
});

describe("GitHubIssuesTracker.openTicket error paths", () => {
  test("throws a helpful message when owner + repo are unset", async () => {
    const { client } = scriptedClient([]);
    const tracker = new GitHubIssuesTracker(client, { authToken: "t" });
    await assert.rejects(
      () => tracker.openTicket(alert(), ctx()),
      /owner.*repo.*required/i,
    );
  });

  test("error lists which of owner/repo are missing", async () => {
    const { client } = scriptedClient([]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
    });
    await assert.rejects(
      () => tracker.openTicket(alert(), ctx()),
      /repo=<missing>/,
    );
  });

  test("re-throws 422 with a wrapped message including owner/repo", async () => {
    const { client } = scriptedClient([
      () =>
        new Response(
          JSON.stringify({
            message: "Validation Failed",
            errors: [{ resource: "Issue", code: "custom" }],
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
    ]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
    });
    await assert.rejects(
      () => tracker.openTicket(alert(), ctx()),
      (err: unknown) => {
        const msg = String((err as Error).message);
        assert.match(msg, /could not create issue in my-org\/my-app/);
        assert.match(msg, /Validation Failed/);
        return true;
      },
    );
  });

  test("propagates 401 GitHubAuthError untouched", async () => {
    const { client } = scriptedClient([
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
    });
    await assert.rejects(
      () => tracker.openTicket(alert(), ctx()),
      /Bad credentials/,
    );
  });

  test("propagates 403 GitHubForbiddenError untouched", async () => {
    const { client } = scriptedClient([
      () =>
        new Response(JSON.stringify({ message: "Must have admin rights" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const tracker = new GitHubIssuesTracker(client, {
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
    });
    await assert.rejects(
      () => tracker.openTicket(alert(), ctx()),
      /Must have admin rights/,
    );
  });
});

describe("factory exports", () => {
  test("createGitHubIssuesTracker returns a working tracker", async () => {
    const tracker = await createGitHubIssuesTracker({
      authToken: "t",
      defaultOwner: "my-org",
      defaultRepo: "my-app",
      fetchImpl: async () => jsonResponse({ number: 1, html_url: "x", state: "open" }),
      sleep: async () => {},
    });
    assert.equal(tracker.id, "github-issues");
    const ref = await tracker.openTicket(alert(), ctx());
    assert.ok(ref);
    assert.equal(ref.id, "1");
  });

  test("createPlugin is the same factory (CLI resolver alias)", () => {
    assert.equal(createPlugin, createGitHubIssuesTracker);
  });

  test("default export is the factory", async () => {
    const mod = await import("../index.js");
    assert.equal(mod.default, createGitHubIssuesTracker);
  });
});
