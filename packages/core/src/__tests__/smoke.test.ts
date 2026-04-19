import { strict as assert } from "node:assert";
import { test } from "node:test";

import { expandEnv } from "../config.js";

test("sanity: tsx runs Node --test", () => {
  assert.equal(1 + 1, 2);
});

test("sanity: package code is reachable", () => {
  assert.equal(expandEnv("${FOO}", { FOO: "bar" }), "bar");
});
