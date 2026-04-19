import { strict as assert } from "node:assert";
import { test } from "node:test";

import createWebhookNotifier from "../index.js";

test("webhook notifier factory throws when url is missing", () => {
  // Keeps a minimum coverage floor so CI has a discoverable test here.
  assert.throws(
    () => createWebhookNotifier({} as unknown as { url: string }),
    /'url' option is required/,
  );
});

test("webhook notifier reports id 'webhook'", () => {
  const n = createWebhookNotifier({ url: "https://example.test" });
  assert.equal((n as { id: string }).id, "webhook");
});
