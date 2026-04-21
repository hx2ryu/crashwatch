/**
 * Thin fetch wrapper over the Sentry public REST API (`https://sentry.io/api/0/...`).
 *
 * Responsibilities kept deliberately narrow:
 *   - attach the Bearer auth header
 *   - parse the `Link` header for `rel="next"; results="true"` cursors
 *   - retry 429 / 503 responses with jittered exponential backoff, honouring
 *     a `Retry-After` header when the server supplies one
 *
 * Response JSON is returned as-is; shape normalisation lives in `mappers.ts`.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleeper = (ms: number) => Promise<void>;
export type Randomiser = () => number;

export interface SentryApiOptions {
  /** Personal / org auth token. Scopes required: `event:read`, `project:read`. */
  authToken: string;
  /** Override for self-hosted Sentry or tests. Defaults to `https://sentry.io/api/0`. */
  baseUrl?: string;
  /** Inject a custom fetch (tests, Undici-based clients). Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Max retries for 429 / 503. Default 3 — four attempts total. */
  maxRetries?: number;
  /** Injectable for tests. Default uses `setTimeout`. */
  sleep?: Sleeper;
  /** Injectable for tests. Default `Math.random`. */
  random?: Randomiser;
}

export interface SentryPage<T> {
  items: T[];
  /** Opaque cursor for the next page, or `undefined` when the server says there is none. */
  nextCursor?: string;
}

const DEFAULT_BASE_URL = "https://sentry.io/api/0";
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_JITTER_MS = 500;

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class SentryApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly sleep: Sleeper;
  private readonly random: Randomiser;

  constructor(private readonly opts: SentryApiOptions) {
    if (!opts.authToken) {
      throw new Error(
        "@hx2ryu/crashwatch-provider-sentry: `authToken` is required. Create one at " +
          "https://sentry.io/settings/account/api/auth-tokens/ with scopes " +
          "`event:read` and `project:read`.",
      );
    }
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  /**
   * Fetch a single page of list results. Pass an opaque `cursor` returned from
   * a previous call to advance; omit it for the first page.
   */
  async getPage<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    cursor?: string,
  ): Promise<SentryPage<T>> {
    const url = this.buildUrl(path, query, cursor);
    const res = await this.request(url);
    const body = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(
        `Sentry: expected a JSON array from ${path} but got ${typeof body}.`,
      );
    }
    return {
      items: body as T[],
      nextCursor: parseNextCursor(res.headers.get("link")),
    };
  }

  /**
   * Fetch a single JSON object (or `null` on 404). Use for detail endpoints
   * that return one resource rather than an array.
   */
  async getOne<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T | null> {
    const url = this.buildUrl(path, query, undefined);
    try {
      const res = await this.request(url);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  /**
   * Iterate across pages until the server reports no more results OR `max`
   * items have been yielded. `max === 0` disables the cap.
   */
  async *paginate<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    max = 0,
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    let emitted = 0;
    while (true) {
      const page = await this.getPage<T>(path, query, cursor);
      for (const item of page.items) {
        yield item;
        emitted += 1;
        if (max > 0 && emitted >= max) return;
      }
      if (!page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }

  private buildUrl(
    path: string,
    query: Record<string, string | number | undefined>,
    cursor: string | undefined,
  ): string {
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl}${leadingSlash(path)}`,
    );
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    return url.toString();
  }

  private async request(url: string): Promise<Response> {
    const headers = {
      Authorization: `Bearer ${this.opts.authToken}`,
      Accept: "application/json",
    };
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers });
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries) break;
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        if (attempt === this.maxRetries) {
          throw new Error(
            `Sentry ${res.status} after ${this.maxRetries + 1} attempts: ${url}`,
          );
        }
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        await this.sleep(retryAfter ?? this.backoffMs(attempt));
        continue;
      }
      if (res.status === 404) {
        throw new NotFoundError(`Sentry 404 for ${url}`);
      }
      if (!res.ok) {
        const body = await safeReadBody(res);
        throw new Error(
          `Sentry ${res.status} ${res.statusText} for ${url}: ${body}`,
        );
      }
      return res;
    }
    throw new Error(
      `Sentry fetch failed after ${this.maxRetries + 1} attempts: ${url}: ` +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    );
  }

  private backoffMs(attempt: number): number {
    const base = RETRY_BASE_MS * 2 ** attempt;
    return base + Math.floor(this.random() * RETRY_JITTER_MS);
  }
}

function leadingSlash(p: string): string {
  return p.startsWith("/") ? p : `/${p}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

/**
 * `Retry-After` is either an integer number of seconds or an HTTP-date. We only
 * honour the integer form — a date-based value is rare in practice and the
 * exponential-backoff fallback already covers that path safely.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

/**
 * Parse a Sentry `Link` header and return the cursor attached to the
 * `rel="next"` entry, but **only if** `results="true"`. When the server reports
 * `results="false"`, it is signalling "no more pages" — we must not advance.
 *
 * Example header (whitespace added for readability):
 *   <https://sentry.io/api/0/projects/foo/bar/issues/?&cursor=A>; rel="previous"; results="false"; cursor="A",
 *   <https://sentry.io/api/0/projects/foo/bar/issues/?&cursor=B>; rel="next"; results="true"; cursor="B"
 */
export function parseNextCursor(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const entry of splitLinkEntries(header)) {
    const rel = /rel="([^"]+)"/.exec(entry)?.[1];
    if (rel !== "next") continue;
    const results = /results="([^"]+)"/.exec(entry)?.[1];
    if (results !== "true") return undefined;
    const cursor = /cursor="([^"]+)"/.exec(entry)?.[1];
    if (cursor) return cursor;
  }
  return undefined;
}

/**
 * Split a `Link` header on top-level commas — URLs can contain `,` inside
 * brackets, so a plain `split(",")` breaks real-world Sentry responses.
 */
function splitLinkEntries(header: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = header.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}
