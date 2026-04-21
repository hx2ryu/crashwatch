import { strict as assert } from "node:assert";
import { test } from "node:test";

import createSlackNotifier from "../index.js";

test("slack notifier delegates to the underlying webhook", () => {
  const n = createSlackNotifier({ webhookUrl: "https://example.test/slack" });
  // The wrapper forwards to @hx2ryu/crashwatch-notifier-webhook, which identifies
  // itself as "webhook". We only verify the instance is constructable.
  assert.ok(n);
  assert.equal(typeof (n as { notify: unknown }).notify, "function");
});
