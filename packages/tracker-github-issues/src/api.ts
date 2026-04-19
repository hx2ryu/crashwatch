/**
 * Thin fetch wrapper over the GitHub REST API (`https://api.github.com/...`).
 *
 * Responsibilities kept deliberately narrow:
 *   - attach `Authorization: Bearer`, `Accept`, `X-GitHub-Api-Version` and
 *     `User-Agent` headers every call
 *   - retry 429 / 502 / 503 with jittered exponential backoff, honouring a
 *     `Retry-After` header when GitHub supplies one
 *   - surface 401 / 403 with an actionable "bad/insufficient token" message,
 *     preserving GitHub's JSON `message` field when present
 *
 * Response JSON is returned parsed; shape normalisation lives in `index.ts`.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleeper = (ms: number) => Promise<void>;
export type Randomiser = () => number;

export interface GitHubApiOptions {
  /** Personal access token. For private repos needs the `repo` scope; for public,
   *  `public_repo` is enough. Fine-grained tokens need `Issues: Read and write`. */
  authToken: string;
  /** Override for GitHub Enterprise Server or tests. Defaults to
   *  `https://api.github.com`. */
  baseUrl?: string;
  /** Inject a custom fetch (tests, Undici-based clients). Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Max retries for 429 / 502 / 503. Default 3 — four attempts total. */
  maxRetries?: number;
  /** Injectable for tests. Default uses `setTimeout`. */
  sleep?: Sleeper;
  /** Injectable for tests. Default `Math.random`. */
  random?: Randomiser;
}

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "crashwatch";
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_JITTER_MS = 500;

/** Thrown when GitHub responds 401 — credentials are missing or invalid. */
export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

/** Thrown when GitHub responds 403 — the token is present but lacks scope, or
 *  the caller is rate-limited at the resource level (secondary rate limit). */
export class GitHubForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubForbiddenError";
  }
}

/** Thrown when GitHub responds 422 — usually a validation error on the body.
 *  For issue creation, the caller should treat this as "couldn't create" and
 *  propagate GitHub's message. */
export class GitHubValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubValidationError";
  }
}

export class GitHubApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly sleep: Sleeper;
  private readonly random: Randomiser;

  constructor(private readonly opts: GitHubApiOptions) {
    if (!opts.authToken) {
      throw new Error(
        "@crashwatch/tracker-github-issues: `authToken` is required. Create a " +
          "personal access token at https://github.com/settings/tokens with the " +
          "`repo` scope (or `public_repo` for public repos only), then pass it " +
          "as `authToken` in the tracker options.",
      );
    }
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  /**
   * POST a JSON body to a path, returning the parsed JSON response.
   * Retries 429 / 502 / 503 with jittered backoff; surfaces 401 / 403 / 422
   * with actionable messages.
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.request(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  private buildUrl(path: string): string {
    return path.startsWith("http")
      ? path
      : `${this.baseUrl}${leadingSlash(path)}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.authToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": DEFAULT_USER_AGENT,
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, headers });
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries) break;
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (res.status === 429 || res.status === 502 || res.status === 503) {
        if (attempt === this.maxRetries) {
          throw new Error(
            `GitHub ${res.status} after ${this.maxRetries + 1} attempts: ${url}`,
          );
        }
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        await this.sleep(retryAfter ?? this.backoffMs(attempt));
        continue;
      }
      if (res.status === 401) {
        const msg = await readGithubMessage(res);
        throw new GitHubAuthError(
          `GitHub 401 Unauthorized: ${msg ?? "bad credentials"}. ` +
            "Check that `authToken` is a valid personal access token and has not " +
            "been revoked or expired. Create a new one at " +
            "https://github.com/settings/tokens.",
        );
      }
      if (res.status === 403) {
        const msg = await readGithubMessage(res);
        throw new GitHubForbiddenError(
          `GitHub 403 Forbidden: ${msg ?? "insufficient permissions"}. ` +
            "The token is valid but cannot perform this action. Ensure it has " +
            "the `repo` scope (or `public_repo` for public repositories), and " +
            "that the authenticated user has write access to the target " +
            "repository.",
        );
      }
      if (res.status === 422) {
        const msg = await readGithubMessage(res);
        throw new GitHubValidationError(
          `GitHub 422 Unprocessable: ${msg ?? "validation failed"}.`,
        );
      }
      if (!res.ok) {
        const body = await safeReadBody(res);
        throw new Error(
          `GitHub ${res.status} ${res.statusText} for ${url}: ${body}`,
        );
      }
      return res;
    }
    throw new Error(
      `GitHub fetch failed after ${this.maxRetries + 1} attempts: ${url}: ` +
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
 * Try to pull GitHub's JSON `message` field from an error response. Falls back
 * to `undefined` if the body isn't JSON or doesn't contain one. GitHub's error
 * envelope is `{ "message": "...", "documentation_url": "..." }`.
 */
async function readGithubMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // non-JSON or empty body — fall through
  }
  return undefined;
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
