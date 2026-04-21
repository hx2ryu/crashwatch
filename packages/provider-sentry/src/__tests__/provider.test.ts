import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { AppRef } from "@hx2ryu/crashwatch-core";

import { SentryApiClient, type FetchLike } from "../api.js";
import { SentryProvider, createSentryProvider } from "../index.js";

interface Recorded {
  url: string;
}

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
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

function scriptedClient(
  responses: Array<() => Response>,
): { client: SentryApiClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url) => {
    calls.push({ url: String(url) });
    const make = queue.shift();
    if (!make) throw new Error("scriptedClient: out of scripted responses");
    return make();
  };
  const client = new SentryApiClient({
    authToken: "t",
    fetchImpl,
    sleep: async () => {},
    random: () => 0,
  });
  return { client, calls };
}

function app(overrides: Partial<AppRef["providerOptions"]> = {}): AppRef {
  return {
    name: "example-app",
    platform: "android",
    providerOptions: {
      project: "mobile-android",
      environment: "production",
      ...overrides,
    },
  };
}

describe("SentryProvider construction", () => {
  test("throws when `org` is missing", () => {
    const { client } = scriptedClient([]);
    assert.throws(
      () => new SentryProvider(client, { authToken: "t", org: "" }),
      /`org` is required/,
    );
  });

  test("createSentryProvider factory returns a working provider", async () => {
    const provider = await createSentryProvider({
      authToken: "t",
      org: "my-org",
      fetchImpl: async () => jsonResponse([]),
      sleep: async () => {},
    });
    assert.equal(provider.id, "sentry");
  });
});

describe("SentryProvider.supports", () => {
  test("advertises listIssues, listEvents, pagination, signals", () => {
    const { client } = scriptedClient([]);
    const provider = new SentryProvider(client, { authToken: "t", org: "my-org" });
    assert.equal(provider.supports!("listIssues"), true);
    assert.equal(provider.supports!("listEvents"), true);
    assert.equal(provider.supports!("pagination"), true);
    assert.equal(provider.supports!("signals"), true);
    assert.equal(provider.supports!("getReport"), false);
  });
});

describe("SentryProvider.listIssues", () => {
  test("hits /projects/<org>/<project>/issues/ with window params", async () => {
    const issues = fixture<object[]>("issues.json");
    const { client, calls } = scriptedClient([() => jsonResponse(issues)]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    const out = await provider.listIssues(app(), { limit: 10 });
    assert.equal(out.length, 2);
    const url = new URL(calls[0]!.url);
    assert.equal(
      url.origin + url.pathname,
      "https://sentry.io/api/0/projects/my-org/mobile-android/issues/",
    );
    assert.ok(url.searchParams.get("start"));
    assert.ok(url.searchParams.get("end"));
    assert.equal(url.searchParams.get("environment"), "production");
  });

  test("respects filter.limit by stopping pagination early", async () => {
    const link =
      '<https://sentry.io/api/0/x/?&cursor=B>; rel="next"; results="true"; cursor="B"';
    const issues = fixture<object[]>("issues.json");
    const { client, calls } = scriptedClient([
      () => jsonResponse(issues, { headers: { link } }),
    ]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    const out = await provider.listIssues(app(), { limit: 1 });
    assert.equal(out.length, 1);
    assert.equal(calls.length, 1);
  });

  test("filter.signals is translated to Sentry's query language", async () => {
    const { client, calls } = scriptedClient([() => jsonResponse([])]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    await provider.listIssues(app(), { signals: ["SIGNAL_REGRESSED"] });
    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get("query"), "is:regressed");
  });

  test("resolves project from defaultProject when app omits it", async () => {
    const { client, calls } = scriptedClient([() => jsonResponse([])]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
      defaultProject: "fallback",
    });
    await provider.listIssues(
      { name: "a", platform: "android", providerOptions: {} },
      {},
    );
    assert.match(calls[0]!.url, /\/projects\/my-org\/fallback\/issues\//);
  });

  test("throws when neither app nor defaults supply a project", async () => {
    const { client } = scriptedClient([]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    await assert.rejects(
      () =>
        provider.listIssues(
          { name: "a", platform: "android", providerOptions: {} },
          {},
        ),
      /missing providerOptions\.project/,
    );
  });
});

describe("SentryProvider.getIssue", () => {
  test("fetches issue detail then one sample event", async () => {
    const detail = fixture<object>("issue-detail.json");
    const events = fixture<object[]>("events.json");
    const { client, calls } = scriptedClient([
      () => jsonResponse(detail),
      () => jsonResponse(events),
    ]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    const out = await provider.getIssue(app(), "4123456789");
    assert.equal(out.id, "4123456789");
    assert.equal(out.state, "closed");
    assert.equal(out.sampleEvent?.id, "e1111111111111111111111111111111");
    assert.match(
      calls[0]!.url,
      /\/organizations\/my-org\/issues\/4123456789\/$/,
    );
    assert.match(calls[1]!.url, /\/issues\/4123456789\/events\//);
  });

  test("returns a placeholder detail on 404", async () => {
    const { client } = scriptedClient([
      () => new Response("", { status: 404 }),
    ]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    const out = await provider.getIssue(app(), "missing");
    assert.equal(out.state, "unknown");
    assert.equal(out.title, "(not found)");
  });
});

describe("SentryProvider.listEvents", () => {
  test("without issueId, hits /projects/.../events/", async () => {
    const { client, calls } = scriptedClient([() => jsonResponse([])]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    await provider.listEvents(app(), { limit: 5 });
    assert.match(
      calls[0]!.url,
      /\/projects\/my-org\/mobile-android\/events\//,
    );
  });

  test("with issueId, hits /organizations/.../issues/<id>/events/", async () => {
    const events = fixture<object[]>("events.json");
    const { client, calls } = scriptedClient([() => jsonResponse(events)]);
    const provider = new SentryProvider(client, {
      authToken: "t",
      org: "my-org",
    });
    const out = await provider.listEvents(app(), { issueId: "4123456789" });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.issueId, "4123456789");
    assert.match(
      calls[0]!.url,
      /\/organizations\/my-org\/issues\/4123456789\/events\//,
    );
  });
});
