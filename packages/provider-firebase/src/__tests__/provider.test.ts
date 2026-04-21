import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { AppRef } from "@hx2ryu/crashwatch-core";

import type { BigqueryClient, QueryRow } from "../bigquery.js";
import { FirebaseProvider } from "../index.js";

class FakeBq implements BigqueryClient {
  calls: Array<{ sql: string; params: Record<string, unknown> }> = [];
  private queue: QueryRow[][] = [];

  enqueue(rows: QueryRow[]): void {
    this.queue.push(rows);
  }

  async query(
    sql: string,
    params: Record<string, unknown>,
    _types?: Record<string, string>,
  ): Promise<QueryRow[]> {
    this.calls.push({ sql, params });
    return this.queue.shift() ?? [];
  }
}

function app(overrides: Partial<AppRef["providerOptions"]> = {}): AppRef {
  return {
    name: "test-app",
    platform: "android",
    providerOptions: {
      bigqueryTable: "p.d.t_ANDROID",
      ...overrides,
    },
  };
}

describe("FirebaseProvider.listIssues", () => {
  test("renders the table into the SQL and binds window params", async () => {
    const bq = new FakeBq();
    bq.enqueue([
      {
        issue_id: "abc",
        issue_title: "Boom",
        events: 10,
        fatal_events: 10,
        last_seen_version: "1.0.0",
      },
    ]);
    const provider = new FirebaseProvider(bq, { defaultWindowHours: 24 });
    const issues = await provider.listIssues(app(), { limit: 5 });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.id, "abc");
    assert.equal(issues[0]!.errorType, "fatal");
    assert.equal(bq.calls.length, 1);
    const { sql, params } = bq.calls[0]!;
    assert.match(sql, /`p\.d\.t_ANDROID`/);
    assert.equal(params.limit, 5);
    assert.ok(params.from && params.to, "from/to were bound");
  });

  test("throws when bigqueryTable is missing on the app", async () => {
    const bq = new FakeBq();
    const provider = new FirebaseProvider(bq, {});
    await assert.rejects(
      () =>
        provider.listIssues(
          { name: "a", platform: "android", providerOptions: {} },
          {},
        ),
      /missing providerOptions\.bigqueryTable/,
    );
  });

  test("rejects malicious table ids up front", async () => {
    const bq = new FakeBq();
    const provider = new FirebaseProvider(bq, {});
    await assert.rejects(
      () =>
        provider.listIssues(
          {
            name: "a",
            platform: "android",
            providerOptions: { bigqueryTable: "p.d.t; DROP TABLE users" },
          },
          {},
        ),
      /Invalid BigQuery table id/,
    );
  });
});

describe("FirebaseProvider.getIssue", () => {
  test("runs GET_ISSUE_SQL then LIST_EVENTS_SQL with issueId", async () => {
    const bq = new FakeBq();
    bq.enqueue([{ issue_id: "abc", events: 2, fatal_events: 1 }]);
    bq.enqueue([
      {
        issue_id: "abc",
        event_id: "e-1",
        event_timestamp: "2026-04-19T00:00:00Z",
      },
    ]);
    const provider = new FirebaseProvider(bq, {});
    const detail = await provider.getIssue(app(), "abc");
    assert.equal(detail.id, "abc");
    assert.equal(detail.sampleEvent?.id, "e-1");
    assert.equal(bq.calls.length, 2);
    assert.match(bq.calls[1]!.sql, /AND issue_id = @issueId/);
    assert.equal(bq.calls[1]!.params.issueId, "abc");
  });

  test("returns a placeholder detail when the issue window is empty", async () => {
    const bq = new FakeBq();
    // issue query returns 0 rows; provider should short-circuit
    bq.enqueue([]);
    const provider = new FirebaseProvider(bq, {});
    const detail = await provider.getIssue(app(), "missing");
    assert.equal(detail.id, "missing");
    assert.equal(detail.state, "unknown");
    assert.equal(bq.calls.length, 1);
  });
});

describe("FirebaseProvider.listEvents", () => {
  test("omits the issue filter clause when filter.issueId is absent", async () => {
    const bq = new FakeBq();
    bq.enqueue([]);
    const provider = new FirebaseProvider(bq, {});
    await provider.listEvents(app(), { limit: 10 });
    assert.equal(bq.calls.length, 1);
    assert.equal(bq.calls[0]!.sql.includes("issue_id = @issueId"), false);
    assert.equal(bq.calls[0]!.params.limit, 10);
  });

  test("adds the issue filter and binds issueId when present", async () => {
    const bq = new FakeBq();
    bq.enqueue([]);
    const provider = new FirebaseProvider(bq, {});
    await provider.listEvents(app(), { issueId: "abc" });
    assert.match(bq.calls[0]!.sql, /AND issue_id = @issueId/);
    assert.equal(bq.calls[0]!.params.issueId, "abc");
  });
});

describe("FirebaseProvider.getReport", () => {
  test("runs TOP_VERSIONS for topVersions", async () => {
    const bq = new FakeBq();
    bq.enqueue([{ dimension: "1.2.3", events: 4, impacted_users: 2 }]);
    const provider = new FirebaseProvider(bq, {});
    const rows = await provider.getReport(app(), "topVersions", {});
    assert.equal(rows[0]?.dimension, "1.2.3");
    assert.match(bq.calls[0]!.sql, /application\.display_version AS dimension/);
  });

  test("returns [] for topIssues (use listIssues instead)", async () => {
    const bq = new FakeBq();
    const provider = new FirebaseProvider(bq, {});
    const rows = await provider.getReport(app(), "topIssues", {});
    assert.deepEqual(rows, []);
    assert.equal(bq.calls.length, 0);
  });
});

describe("FirebaseProvider.supports", () => {
  test("advertises the capabilities it actually implements", () => {
    const provider = new FirebaseProvider(new FakeBq(), {});
    assert.equal(provider.supports("listIssues"), true);
    assert.equal(provider.supports("listEvents"), true);
    assert.equal(provider.supports("getReport"), true);
    assert.equal(provider.supports("pagination"), false);
    assert.equal(provider.supports("signals"), false);
  });
});
