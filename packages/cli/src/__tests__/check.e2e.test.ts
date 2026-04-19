import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { check } from "../commands/check.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FAKE_PROVIDER = join(HERE, "fixtures/fake-provider.ts");
const FAKE_NOTIFIER = join(HERE, "fixtures/fake-notifier.ts");

async function writeConfig(
  dir: string,
  body: string,
  name = "config.yaml",
): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, body, "utf8");
  return p;
}

describe("check command end-to-end", () => {
  let workdir: string;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), "crashwatch-cli-"));
  });

  after(async () => {
    // Leave workdir on disk for debugging; tmpdir is cleaned up by the OS.
  });

  test("writes a snapshot and fires new_issue alert on first run", async () => {
    const stateDir = join(workdir, "state-run-1");
    const notifLog = join(workdir, "notif-run-1.log");
    const configPath = await writeConfig(
      workdir,
      `version: 1
providers:
  - id: fake
    plugin: "${FAKE_PROVIDER}"
    options:
      issues:
        - id: I1
          title: New boom
          events: 12
notifiers:
  - id: fake
    plugin: "${FAKE_NOTIFIER}"
    options:
      logFile: "${notifLog}"
apps:
  - name: app-a
    platforms:
      android:
        providerOptions: {}
    providers: [fake]
    notify: [fake]
`,
    );

    await check(["--config", configPath, "--state", stateDir]);

    const snapshot = await readFile(
      join(stateDir, "snapshots/app-a.jsonl"),
      "utf8",
    );
    assert.match(snapshot, /"app-a"/);
    assert.match(snapshot, /"I1"/);

    // With zero history, I1 with 12 events should trigger new_issue.
    const notif = await readFile(notifLog, "utf8");
    assert.match(notif, /"new_issue"/);
    assert.match(notif, /"I1"/);
  });

  test("dry-run writes snapshot but does NOT invoke notifiers", async () => {
    const stateDir = join(workdir, "state-run-2");
    const notifLog = join(workdir, "notif-run-2.log");
    const configPath = await writeConfig(
      workdir,
      `version: 1
providers:
  - id: fake
    plugin: "${FAKE_PROVIDER}"
    options:
      issues:
        - id: I2
          title: Boom 2
          events: 12
notifiers:
  - id: fake
    plugin: "${FAKE_NOTIFIER}"
    options:
      logFile: "${notifLog}"
apps:
  - name: app-b
    platforms:
      android:
        providerOptions: {}
    providers: [fake]
    notify: [fake]
`,
      "config2.yaml",
    );

    await check([
      "--config",
      configPath,
      "--state",
      stateDir,
      "--dry-run",
    ]);

    // Snapshot still written.
    const snapshot = await readFile(
      join(stateDir, "snapshots/app-b.jsonl"),
      "utf8",
    );
    assert.match(snapshot, /"I2"/);

    // Notifier log should not exist.
    let notifierRan = false;
    try {
      await readFile(notifLog, "utf8");
      notifierRan = true;
    } catch {
      notifierRan = false;
    }
    assert.equal(notifierRan, false, "fake notifier should not have been called in --dry-run");
  });

  test("two sequential runs with same state dir produce history the detector can see", async () => {
    const stateDir = join(workdir, "state-run-3");
    const notifLog = join(workdir, "notif-run-3.log");
    const configPath = await writeConfig(
      workdir,
      `version: 1
providers:
  - id: fake
    plugin: "${FAKE_PROVIDER}"
    options:
      issues:
        - id: I3
          title: Boom 3
          events: 12
notifiers:
  - id: fake
    plugin: "${FAKE_NOTIFIER}"
    options:
      logFile: "${notifLog}"
apps:
  - name: app-c
    platforms:
      android:
        providerOptions: {}
    providers: [fake]
    notify: [fake]
`,
      "config3.yaml",
    );

    await check(["--config", configPath, "--state", stateDir]);
    // First run saw I3 for the first time → new_issue alert expected.
    const afterFirst = await readFile(notifLog, "utf8");
    const firstLines = afterFirst.split("\n").filter(Boolean).length;
    assert.equal(firstLines, 1);

    await check(["--config", configPath, "--state", stateDir]);
    // Second run: I3 is now in history → no new_issue; no baseline at 7 days
    // so no spike either. Notifier log should not grow.
    const afterSecond = await readFile(notifLog, "utf8");
    const secondLines = afterSecond.split("\n").filter(Boolean).length;
    assert.equal(
      secondLines,
      1,
      `expected no extra alerts on second run, got ${secondLines - 1} new`,
    );
  });
});
