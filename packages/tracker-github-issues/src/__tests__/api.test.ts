import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  GitHubApiClient,
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubValidationError,
  parseRetryAfter,
  type FetchLike,
} from "../api.js";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
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
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
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
  test("returns undefined for null / non-numeric / negative", () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"), undefined);
    assert.equal(parseRetryAfter("-5"), undefined);
  });
});

describe("GitHubApiClient construction", () => {
  test("rejects a missing auth token with actionable message", () => {
    assert.throws(
      () => new GitHubApiClient({ authToken: "" }),
      /authToken.*required/i,
    );
  });

  test("message tells user how to create a token", () => {
    try {
      new GitHubApiClient({ authToken: "" });
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        String((err as Error).message),
        /github\.com\/settings\/tokens/,
      );
      assert.match(String((err as Error).message), /`repo` scope/);
    }
  });
});

describe("GitHubApiClient.post headers", () => {
  test("attaches Bearer auth, Accept, API version, and User-Agent", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse({ id: 1 })]);
    const client = new GitHubApiClient({
      authToken: "ghp_abc",
      fetchImpl: fn,
    });
    await client.post("/repos/x/y/issues", { title: "t", body: "b" });
    const headers = calls[0]!.headers;
    assert.equal(headers.authorization, "Bearer ghp_abc");
    assert.equal(headers.accept, "application/vnd.github+json");
    assert.equal(headers["x-github-api-version"], "2022-11-28");
    assert.equal(headers["user-agent"], "crashwatch");
    assert.equal(headers["content-type"], "application/json");
  });

  test("sends the body as JSON and method as POST", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse({ id: 1 })]);
    const client = new GitHubApiClient({
      authToken: "ghp_abc",
      fetchImpl: fn,
    });
    await client.post("/repos/x/y/issues", { title: "hello", body: "world" });
    assert.equal(calls[0]!.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]!.body ?? "null"), {
      title: "hello",
      body: "world",
    });
  });

  test("uses the default base URL", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse({ id: 1 })]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await client.post("/repos/x/y/issues", {});
    assert.equal(calls[0]!.url, "https://api.github.com/repos/x/y/issues");
  });

  test("honours a custom baseUrl (e.g. GHES) and strips trailing slash", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse({ id: 1 })]);
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      baseUrl: "https://ghe.example.com/api/v3/",
    });
    await client.post("/repos/x/y/issues", {});
    assert.equal(
      calls[0]!.url,
      "https://ghe.example.com/api/v3/repos/x/y/issues",
    );
  });

  test("returns the parsed JSON response body", async () => {
    const { fn } = recordingFetch([
      () => jsonResponse({ id: 42, number: 7, html_url: "https://x" }),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    const out = await client.post<{ number: number; html_url: string }>(
      "/repos/x/y/issues",
      {},
    );
    assert.equal(out.number, 7);
    assert.equal(out.html_url, "https://x");
  });
});

describe("GitHubApiClient error surfaces", () => {
  test("401 throws GitHubAuthError with GitHub message preserved", async () => {
    const { fn } = recordingFetch([
      () =>
        new Response(
          JSON.stringify({
            message: "Bad credentials",
            documentation_url: "https://docs.github.com",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      (err: unknown) => {
        assert.ok(err instanceof GitHubAuthError);
        assert.match(String((err as Error).message), /Bad credentials/);
        assert.match(
          String((err as Error).message),
          /github\.com\/settings\/tokens/,
        );
        return true;
      },
    );
  });

  test("401 without JSON body still throws GitHubAuthError with guidance", async () => {
    const { fn } = recordingFetch([
      () => new Response("", { status: 401 }),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      (err: unknown) => {
        assert.ok(err instanceof GitHubAuthError);
        assert.match(String((err as Error).message), /Unauthorized/);
        return true;
      },
    );
  });

  test("403 throws GitHubForbiddenError with scope guidance", async () => {
    const { fn } = recordingFetch([
      () =>
        new Response(
          JSON.stringify({ message: "Resource not accessible by integration" }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        ),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      (err: unknown) => {
        assert.ok(err instanceof GitHubForbiddenError);
        assert.match(
          String((err as Error).message),
          /Resource not accessible by integration/,
        );
        assert.match(String((err as Error).message), /`repo` scope/);
        return true;
      },
    );
  });

  test("422 throws GitHubValidationError with GitHub message", async () => {
    const { fn } = recordingFetch([
      () =>
        new Response(
          JSON.stringify({
            message: "Validation Failed",
            errors: [{ field: "title", code: "missing_field" }],
          }),
          {
            status: 422,
            headers: { "content-type": "application/json" },
          },
        ),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      (err: unknown) => {
        assert.ok(err instanceof GitHubValidationError);
        assert.match(String((err as Error).message), /Validation Failed/);
        return true;
      },
    );
  });

  test("other non-ok status throws with the body text", async () => {
    const { fn } = recordingFetch([
      () => new Response("server is on fire", { status: 500 }),
    ]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      /500.*server is on fire/,
    );
  });
});

describe("GitHubApiClient retry behaviour", () => {
  test("retries on 429 honouring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const { fn, calls } = recordingFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse({ number: 1, html_url: "x" }),
    ]);
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });
    await client.post("/repos/x/y/issues", {});
    assert.equal(calls.length, 2);
    assert.equal(sleeps[0], 2000);
  });

  test("retries on 503 with jittered backoff when Retry-After absent", async () => {
    const sleeps: number[] = [];
    const { fn } = recordingFetch([
      () => new Response("", { status: 503 }),
      () => new Response("", { status: 503 }),
      () => jsonResponse({ number: 1, html_url: "x" }),
    ]);
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
    });
    await client.post("/repos/x/y/issues", {});
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 500 + 250);   // base 500 * 2^0 + 500 * 0.5 = 750
    assert.equal(sleeps[1], 1000 + 250);  // base 500 * 2^1 + 500 * 0.5 = 1250
  });

  test("retries on 502 (bad gateway) as well as 503", async () => {
    const { fn, calls } = recordingFetch([
      () => new Response("", { status: 502 }),
      () => jsonResponse({ number: 1, html_url: "x" }),
    ]);
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async () => {},
      random: () => 0,
    });
    await client.post("/repos/x/y/issues", {});
    assert.equal(calls.length, 2);
  });

  test("gives up after maxRetries with an actionable message", async () => {
    const { fn } = recordingFetch([
      () => new Response("", { status: 429 }),
      () => new Response("", { status: 429 }),
    ]);
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      maxRetries: 1,
      sleep: async () => {},
      random: () => 0,
    });
    await assert.rejects(
      () => client.post("/repos/x/y/issues", {}),
      /429 after 2 attempts/,
    );
  });

  test("retries transient fetch rejections", async () => {
    let calls = 0;
    const fn: FetchLike = async (_url, _init) => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return jsonResponse({ number: 1, html_url: "x" });
    };
    const client = new GitHubApiClient({
      authToken: "t",
      fetchImpl: fn,
      sleep: async () => {},
      random: () => 0,
    });
    const out = await client.post<{ number: number }>(
      "/repos/x/y/issues",
      {},
    );
    assert.equal(out.number, 1);
    assert.equal(calls, 2);
  });

  test("absolute URL passed to post is used verbatim", async () => {
    const { fn, calls } = recordingFetch([() => jsonResponse({ number: 1 })]);
    const client = new GitHubApiClient({ authToken: "t", fetchImpl: fn });
    await client.post("https://api.github.com/repos/a/b/issues", {});
    assert.equal(calls[0]!.url, "https://api.github.com/repos/a/b/issues");
  });
});
