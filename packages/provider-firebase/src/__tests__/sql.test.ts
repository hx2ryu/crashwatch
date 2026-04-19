import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  LIST_ISSUES_SQL,
  assertValidTableId,
  renderTable,
} from "../sql.js";

describe("assertValidTableId", () => {
  for (const valid of [
    "project.dataset.table",
    "my-project.firebase_crashlytics.zzem_ANDROID",
    "a.b.c",
    "p-1.ds_x.t-2",
  ]) {
    test(`accepts ${valid}`, () => {
      assert.doesNotThrow(() => assertValidTableId(valid));
    });
  }

  for (const invalid of [
    "",
    "project.dataset",             // too few parts
    "p.d.t.extra",                 // too many parts
    "p.d.t; DROP TABLE users; --", // injection attempt
    "p.d.t OR 1=1",
    "p/d/t",                       // slashes
    "`p`.`d`.`t`",                 // backticks already handled in SQL template
    "p..t",                        // empty middle
    "\n.\n.\n",
    "p.d.t\"",                     // stray quote
  ]) {
    test(`rejects ${JSON.stringify(invalid)}`, () => {
      assert.throws(
        () => assertValidTableId(invalid),
        /Invalid BigQuery table id/,
      );
    });
  }
});

describe("renderTable", () => {
  test("replaces single {TABLE} placeholder", () => {
    const out = renderTable("SELECT 1 FROM `{TABLE}`", "p.d.t");
    assert.match(out, /`p\.d\.t`/);
    assert.equal(out.includes("{TABLE}"), false);
  });

  test("refuses to render with an invalid table id", () => {
    assert.throws(
      () => renderTable(LIST_ISSUES_SQL, "p.d.t; DROP TABLE x"),
      /Invalid BigQuery table id/,
    );
  });
});
