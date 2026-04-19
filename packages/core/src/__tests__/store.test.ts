import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { JsonlSnapshotStore } from "../store.js";
import type { Alert, Snapshot } from "../types.js";

describe("JsonlSnapshotStore", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "crashwatch-store-"));
  });

  after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  test("appendSnapshot then readRecentSnapshots round-trips", async () => {
    const store = new JsonlSnapshotStore(baseDir);
    const s1: Snapshot = {
      capturedAt: "2026-04-19T00:00:00Z",
      appName: "zzem",
      platform: "android",
      issues: [],
    };
    const s2: Snapshot = { ...s1, capturedAt: "2026-04-19T01:00:00Z" };
    await store.appendSnapshot(s1);
    await store.appendSnapshot(s2);
    const read = await store.readRecentSnapshots("zzem", 10);
    assert.equal(read.length, 2);
    assert.equal(read[0]!.capturedAt, s1.capturedAt);
    assert.equal(read[1]!.capturedAt, s2.capturedAt);
  });

  test("readRecentSnapshots honours limit (returns tail)", async () => {
    const store = new JsonlSnapshotStore(baseDir);
    for (let i = 0; i < 5; i++) {
      await store.appendSnapshot({
        capturedAt: `2026-04-19T${String(i).padStart(2, "0")}:00:00Z`,
        appName: "limit-app",
        platform: "ios",
        issues: [],
      });
    }
    const read = await store.readRecentSnapshots("limit-app", 2);
    assert.equal(read.length, 2);
    assert.equal(read[0]!.capturedAt, "2026-04-19T03:00:00Z");
    assert.equal(read[1]!.capturedAt, "2026-04-19T04:00:00Z");
  });

  test("returns empty array when no snapshots yet", async () => {
    const store = new JsonlSnapshotStore(baseDir);
    const read = await store.readRecentSnapshots("unknown", 10);
    assert.deepEqual(read, []);
  });

  test("sanitises unsafe app names into safe file paths", async () => {
    const store = new JsonlSnapshotStore(baseDir);
    // slashes and "../" should not escape the baseDir
    await store.appendSnapshot({
      capturedAt: "2026-04-19T00:00:00Z",
      appName: "../escape/try",
      platform: "android",
      issues: [],
    });
    const read = await store.readRecentSnapshots("../escape/try", 10);
    assert.equal(read.length, 1);
  });

  test("appendAlert writes separately from snapshots", async () => {
    const store = new JsonlSnapshotStore(baseDir);
    const alert: Alert = {
      id: "id1",
      level: "warning",
      kind: "new_issue",
      title: "t",
      summary: "s",
      appName: "alerts-app",
      platform: "android",
      emittedAt: "2026-04-19T00:00:00Z",
    };
    await store.appendAlert(alert);
    // snapshots file should be unaffected (still returns [])
    const snaps = await store.readRecentSnapshots("alerts-app", 10);
    assert.deepEqual(snaps, []);
  });
});
