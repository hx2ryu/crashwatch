import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  NotFoundError,
  SentryApiClient,
  parseNextCursor,
  parseRetryAfter,
  type FetchLike,
} from "../api.js";

interface Recorded {
  url: string;
  headers: Record<string, string>;
}

function recordingFetch(
  responses: Array<() => Response>,
): { fn: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const fn: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === "object") {
      for (const [k, v] of Object.entries(h as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    calls.push({ url: String(url), headers });
    const make = queue.shift();
    if (!make) throw new Error("recordingFetch: out of scripted responses");
    return make();
  };
  return { fn, calls };
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

describe("parseRetryAfter", () => {
  test("returns milliseconds for integer seconds", () => {
    assert.equal(parseRetryAfter("3"), 3000);
  });
  test("returns undefined for non-numeric / missing / negative", () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"), undefined);
    assert.equal(parseRetryAfter("-5"), undefined);
  });
});

describe("parseNextCursor", () => {
  test("returns cursor when rel=next and results=true", () => {
    const header =
      '<https://sentry.io/api/0/foo/?&cursor=A>; rel="previous"; results="false"; cursor="A", ' +
      '<https://sentry.io/api/0/foo/?&cursor=B>; rel="next"; results="true"; cursor="B"';
    assert.equal(parseNextCursor(header), "B");
  });
  test("returns undefined when rel=next but results=false", () => {
    const header = '<https://sentry.io/api/0/foo/?&cursor=X>; rel="next"; results="false"; cursor="X"';
    assert.equal(parseNextCursor(header), undefined);
  });
  test("returns undefined for null / empty / mangled header", () => {
    assert.equal(parseNextCursor(null), undefined);
    assert.equal(parseNextCursor(""), undefined);
    assert.equal(parseNextCursor("garbage"), undefined);
  });
  test("handles commas inside URLs", () => {
    const header =
      '<https://sentry.io/api/0/foo/?query=a,b&cursor=A>; rel="previous"; results="false"; cursor="A", ' +
      '<https://sentry.io/api/0/foo/?query=a,b&cursor=B>; rel="next"; results="true"; cursor="B"';
    assert.equal(parseNextCursor(header), "B");
  });
});

describe("SentryApiClient.getPage", () => {
  test("attaches Bearer auth + JSON accept header", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse([])]);
    const client = new SentryApiClient({ authToken: "tok_123", fetchImpl: fn });
    await client.getPage("/projects/org/proj/issues/");
    assert.equal(calls[0]!.headers.authorization, "Bearer tok_123");
    assert.equal(calls[0]!.headers.accept, "application/json");
  });

  test("builds query string, encodes slugs, forwards cursor", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse([])]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    await client.getPage(
      "/projects/my-org/my proj/issues/",
      { limit: 5, query: "is:unresolved", empty: undefined },
      "cur_1",
    );
    const url = new URL(calls[0]!.url);
    assert.equal(url.origin + url.pathname, "https://sentry.io/api/0/projects/my-org/my%20proj/issues/");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("query"), "is:unresolved");
    assert.equal(url.searchParams.get("cursor"), "cur_1");
    assert.equal(url.searchParams.has("empty"), false);
  });

  test("exposes nextCursor from Link header", async () => {
    const link =
      '<https://sentry.io/api/0/x/?&cursor=NEXT>; rel="next"; results="true"; cursor="NEXT"';
    const { fn } = recordingFetch([
      () => jsonResponse([{ id: "1" }], { headers: { link } }),
    ]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    const page = await client.getPage("/x/");
    assert.equal(page.nextCursor, "NEXT");
    assert.deepEqual(page.items, [{ id: "1" }]);
  });

  test("throws when response is not a JSON array", async () => {
    const { fn } = recordingFetch([() => jsonResponse({ error: "nope" })]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.getPage("/x/"),
      /expected a JSON array/,
    );
  });
});

describe("SentryApiClient.getOne", () => {
  test("returns the parsed object", async () => {
    const { fn } = recordingFetch([() => jsonResponse({ id: "4", title: "boom" })]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    const obj = await client.getOne<{ id: string; title: string }>("/issues/4/");
    assert.equal(obj?.id, "4");
  });

  test("returns null on 404 instead of throwing", async () => {
    const { fn } = recordingFetch([
      () => new Response("", { status: 404 }),
    ]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    const obj = await client.getOne("/issues/missing/");
    assert.equal(obj, null);
  });
});

describe("SentryApiClient retry behaviour", () => {
  test("retries on 429 honouring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const { fn, calls } = recordingFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse([{ id: "1" }]),
    ]);
    const client = new SentryApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });
    const page = await client.getPage("/x/");
    assert.equal(page.items.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(sleeps[0], 2000);
  });

  test("falls back to jittered exponential backoff when Retry-After absent", async () => {
    const sleeps: number[] = [];
    const { fn } = recordingFetch([
      () => new Response("", { status: 503 }),
      () => new Response("", { status: 503 }),
      () => jsonResponse([]),
    ]);
    const client = new SentryApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
    });
    await client.getPage("/x/");
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 500 + 250);   // base 500 * 2^0 + 500*0.5 = 750
    assert.equal(sleeps[1], 1000 + 250);  // base 500 * 2^1 + 500*0.5 = 1250
  });

  test("gives up after maxRetries", async () => {
    const { fn } = recordingFetch([
      () => new Response("", { status: 429 }),
      () => new Response("", { status: 429 }),
    ]);
    const client = new SentryApiClient({
      authToken: "t",
      fetchImpl: fn,
      maxRetries: 1,
      sleep: async () => {},
      random: () => 0,
    });
    await assert.rejects(() => client.getPage("/x/"), /429 after 2 attempts/);
  });

  test("request throws NotFoundError on 404", async () => {
    const { fn } = recordingFetch([() => new Response("", { status: 404 })]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.getPage("/missing/"),
      (err: unknown) => err instanceof NotFoundError,
    );
  });

  test("non-retryable non-ok throws with body", async () => {
    const { fn } = recordingFetch([
      () => new Response("bad token", { status: 401 }),
    ]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(() => client.getPage("/x/"), /401/);
  });
});

describe("SentryApiClient.paginate", () => {
  test("follows rel=next across pages", async () => {
    const linkA =
      '<https://sentry.io/api/0/x/?&cursor=B>; rel="next"; results="true"; cursor="B"';
    const linkB =
      '<https://sentry.io/api/0/x/?&cursor=C>; rel="next"; results="false"; cursor="C"';
    const { fn } = recordingFetch([
      () => jsonResponse([{ id: "1" }, { id: "2" }], { headers: { link: linkA } }),
      () => jsonResponse([{ id: "3" }], { headers: { link: linkB } }),
    ]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    const ids: string[] = [];
    for await (const item of client.paginate<{ id: string }>("/x/")) {
      ids.push(item.id);
    }
    assert.deepEqual(ids, ["1", "2", "3"]);
  });

  test("stops early at max", async () => {
    const linkA =
      '<https://sentry.io/api/0/x/?&cursor=B>; rel="next"; results="true"; cursor="B"';
    const { fn, calls } = recordingFetch([
      () => jsonResponse([{ id: "1" }, { id: "2" }], { headers: { link: linkA } }),
    ]);
    const client = new SentryApiClient({ authToken: "t", fetchImpl: fn });
    const ids: string[] = [];
    for await (const item of client.paginate<{ id: string }>("/x/", {}, 1)) {
      ids.push(item.id);
    }
    assert.deepEqual(ids, ["1"]);
    assert.equal(calls.length, 1); // should not have fetched the next page
  });
});

describe("SentryApiClient construction", () => {
  test("rejects a missing auth token with actionable message", () => {
    assert.throws(
      () => new SentryApiClient({ authToken: "" }),
      /authToken.*required/i,
    );
  });
});
