import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { rowToEvent, rowToIssue, rowToReport } from "../mappers.js";

describe("rowToIssue", () => {
  test("marks as fatal when fatal_events > 0", () => {
    const { issue, events, impactedUsers } = rowToIssue({
      issue_id: "abc",
      issue_title: "Boom",
      issue_subtitle: "SIGABRT",
      events: 42,
      impacted_users: 7,
      fatal_events: 5,
      first_seen: "2026-04-19T00:00:00Z",
      last_seen: "2026-04-19T23:00:00Z",
      last_seen_version: "1.2.3",
    });
    assert.equal(issue.id, "abc");
    assert.equal(issue.errorType, "fatal");
    assert.equal(issue.lastSeenVersion, "1.2.3");
    assert.equal(events, 42);
    assert.equal(impactedUsers, 7);
  });

  test("non_fatal when fatal_events is 0", () => {
    const { issue } = rowToIssue({
      issue_id: "abc",
      events: 1,
      fatal_events: 0,
    });
    assert.equal(issue.errorType, "non_fatal");
  });

  test("normalises BigQuery Date-like .value field to ISO string", () => {
    const { issue } = rowToIssue({
      issue_id: "abc",
      events: 0,
      first_seen: { value: "2026-04-19T12:00:00Z" },
      last_seen: new Date("2026-04-19T13:00:00Z"),
    });
    assert.equal(issue.firstSeen, "2026-04-19T12:00:00Z");
    assert.equal(issue.lastSeen, "2026-04-19T13:00:00.000Z");
  });

  test("tolerates numeric strings and bigints in counts", () => {
    const { events, impactedUsers } = rowToIssue({
      issue_id: "abc",
      events: "17" as unknown as number,
      impacted_users: 9n as unknown as number,
    });
    assert.equal(events, 17);
    assert.equal(impactedUsers, 9);
  });

  test("supplies safe defaults when title is missing", () => {
    const { issue } = rowToIssue({ issue_id: "abc", events: 0 });
    assert.equal(issue.title, "(untitled)");
  });
});

describe("rowToEvent", () => {
  test("maps device and OS records when present", () => {
    const ev = rowToEvent({
      event_id: "e1",
      event_timestamp: "2026-04-19T00:00:00Z",
      issue_id: "abc",
      is_fatal: true,
      app_version: "1.2.3",
      device_manufacturer: "samsung",
      device_model: "SM-S938N",
      os_name: "Android",
      os_version: "16",
    });
    assert.equal(ev.id, "e1");
    assert.equal(ev.issueId, "abc");
    assert.equal(ev.device?.manufacturer, "samsung");
    assert.equal(ev.os?.version, "16");
    assert.equal(ev.appVersion, "1.2.3");
  });

  test("falls back to synthetic id when event_id missing", () => {
    const ev = rowToEvent({
      issue_id: "abc",
      event_timestamp: "2026-04-19T00:00:00Z",
    });
    assert.equal(ev.id, "abc:2026-04-19T00:00:00Z");
  });

  test("maps blame_frame into a single stack frame", () => {
    const ev = rowToEvent({
      issue_id: "abc",
      blame_frame: {
        library: "libc.so",
        address: "0x71a0",
        file: "libc.c",
        line: 42,
      },
    });
    assert.equal(ev.stackFrames?.length, 1);
    assert.equal(ev.stackFrames?.[0]?.library, "libc.so");
    assert.equal(ev.stackFrames?.[0]?.line, 42);
  });

  test("skips breadcrumb entries that aren't objects", () => {
    const ev = rowToEvent({
      issue_id: "abc",
      breadcrumbs: [
        { name: "view", timestamp: "2026-04-19T00:00:00Z", data: { k: 1 } },
        null,
        "noise",
      ],
    });
    assert.equal(ev.breadcrumbs?.length, 1);
    assert.equal(ev.breadcrumbs?.[0]?.name, "view");
  });
});

describe("rowToReport", () => {
  test("maps dimension / events / impacted_users", () => {
    assert.deepEqual(
      rowToReport({ dimension: "samsung SM-S938N", events: 10, impacted_users: 3 }),
      { dimension: "samsung SM-S938N", events: 10, impactedUsers: 3 },
    );
  });

  test("defaults events to 0 when missing", () => {
    const r = rowToReport({ dimension: "x", events: undefined as unknown as number });
    assert.equal(r.events, 0);
  });
});
