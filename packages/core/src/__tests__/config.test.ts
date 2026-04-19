import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { expandEnv, loadConfig } from "../config.js";

describe("expandEnv", () => {
  test("substitutes a present variable", () => {
    assert.equal(expandEnv("prefix-${FOO}", { FOO: "bar" }), "prefix-bar");
  });

  test("uses default for missing variable", () => {
    assert.equal(expandEnv("${MISSING:-fallback}", {}), "fallback");
  });

  test("uses default for empty variable", () => {
    assert.equal(expandEnv("${EMPTY:-fallback}", { EMPTY: "" }), "fallback");
  });

  test("leaves unknown variable without default as empty string", () => {
    assert.equal(expandEnv("x=${MISSING}-end", {}), "x=-end");
  });

  test("recurses through arrays", () => {
    assert.deepEqual(
      expandEnv(["${A}", "plain", "${B:-d}"], { A: "1" }),
      ["1", "plain", "d"],
    );
  });

  test("recurses through objects", () => {
    assert.deepEqual(
      expandEnv({ a: "${X}", nested: { b: "${Y:-hello}" } }, { X: "ok" }),
      { a: "ok", nested: { b: "hello" } },
    );
  });

  test("passes through non-string scalars", () => {
    assert.equal(expandEnv(42 as unknown as string, {}), 42);
    assert.equal(expandEnv(true as unknown as string, {}), true);
    assert.equal(expandEnv(null as unknown as string, {}), null);
  });
});

describe("loadConfig", () => {
  async function writeTempConfig(body: string, ext = "yaml"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "crashwatch-config-"));
    const p = join(dir, `crashwatch.${ext}`);
    await writeFile(p, body, "utf8");
    return p;
  }

  test("parses valid YAML and returns configDir", async () => {
    const path = await writeTempConfig(
      `version: 1
providers:
  - id: fake
    plugin: ./plugins/fake.js
notifiers: []
apps:
  - name: app
    platforms:
      android:
        providerOptions:
          key: value
`,
    );
    const { config, configDir } = await loadConfig(path);
    assert.equal(config.version, 1);
    assert.equal(config.apps[0]!.name, "app");
    assert.equal(configDir, path.replace(/\/crashwatch\.yaml$/, ""));
  });

  test("expands ${VAR} in the loaded object", async () => {
    const path = await writeTempConfig(
      `version: 1
providers:
  - id: p
    plugin: ./p.js
    options:
      url: "\${TEST_URL}"
notifiers: []
apps:
  - name: a
    platforms:
      android:
        providerOptions: {}
`,
    );
    const { config } = await loadConfig(path, { TEST_URL: "https://x" });
    assert.equal(
      (config.providers[0]!.options as { url: string }).url,
      "https://x",
    );
  });

  test("rejects unknown version", async () => {
    const path = await writeTempConfig(
      `version: 99
providers: [{ id: x, plugin: y }]
notifiers: []
apps: [{ name: a, platforms: { android: { providerOptions: {} } } }]
`,
    );
    await assert.rejects(() => loadConfig(path), /Unsupported config version/);
  });

  test("rejects empty providers", async () => {
    const path = await writeTempConfig(
      `version: 1
providers: []
notifiers: []
apps: [{ name: a, platforms: { android: { providerOptions: {} } } }]
`,
    );
    await assert.rejects(() => loadConfig(path), /at least one provider/);
  });

  test("rejects empty apps", async () => {
    const path = await writeTempConfig(
      `version: 1
providers: [{ id: x, plugin: y }]
notifiers: []
apps: []
`,
    );
    await assert.rejects(() => loadConfig(path), /at least one app/);
  });

  test("accepts JSON as well as YAML", async () => {
    const body = JSON.stringify({
      version: 1,
      providers: [{ id: "x", plugin: "y" }],
      notifiers: [],
      apps: [{ name: "a", platforms: { android: { providerOptions: {} } } }],
    });
    const path = await writeTempConfig(body, "json");
    const { config } = await loadConfig(path);
    assert.equal(config.apps[0]!.name, "a");
  });
});
