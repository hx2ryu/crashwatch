# @crashwatch/tracker-github-issues

GitHub Issues tracker for [crashwatch](../../README.md).

## What this does

When a crashwatch alert fires, this plugin opens a new issue in a GitHub repository describing the crash. The created issue's `html_url` is returned to the runner, which records it on the alert so downstream storage can deduplicate repeat alerts for the same underlying crash issue.

Requests go to:

```
POST https://api.github.com/repos/{owner}/{repo}/issues
```

502 / 503 / 429 responses are retried with jittered exponential backoff, honouring `Retry-After` when present. 401 / 403 / 422 are surfaced with actionable error messages — the GitHub `message` field from the JSON body is preserved verbatim.

If you run GitHub Enterprise Server, pass `baseUrl: "https://ghe.example.com/api/v3"` in the tracker options.

## Install

```bash
pnpm add @crashwatch/tracker-github-issues
```

No extra native or cloud-SDK dependencies; the tracker uses the built-in `fetch` shipped with Node ≥ 18.

## Create a token

1. Go to **https://github.com/settings/tokens** and create a personal access token.
2. Choose the scope:
   - `repo` — required to open issues in private repositories.
   - `public_repo` — sufficient if the target repo is public.
   - Fine-grained tokens need **Issues: Read and write** on the target repository.
3. Export the token:

   ```bash
   export GITHUB_TOKEN="ghp_..."
   ```

Tokens are sent as `Authorization: Bearer <token>`.

## Configure

```yaml
version: 1
trackers:
  - id: github
    plugin: "@crashwatch/tracker-github-issues"
    options:
      authToken: "${GITHUB_TOKEN}"
      defaultOwner: "my-org"
      defaultRepo: "my-app"      # optional; apps can override
      labels: ["crash", "crashwatch"]
      assignees: ["alice"]

apps:
  - name: example-app
    trackerOptions:
      github:
        owner: "my-org"
        repo: "example-app-android"   # overrides defaultRepo for this app
        labels: ["android"]            # fully replaces tracker-level labels
```

### Per-alert overrides

Any of the following fields on `TrackerContext.options` (set by the runner for each alert) overrides the tracker-level default:

| Field | Behaviour |
|---|---|
| `owner` | Repo owner (user or org) — falls back to `defaultOwner`. |
| `repo` | Repo name — falls back to `defaultRepo`. |
| `labels` | Full replacement, not merge — falls back to tracker-level `labels`. |
| `assignees` | Full replacement, not merge — falls back to tracker-level `assignees`. |

`owner` and `repo` must be resolvable from one side or the other — otherwise the tracker throws a configuration error at alert time.

## Capabilities

| Capability | Supported |
|---|---|
| `openTicket` | ✅ (POSTs `/repos/{owner}/{repo}/issues`) |
| `findTicket` | ❌ (not implemented — the caller deduplicates by the URL recorded on the alert) |

## Issue body format

The issue body is intentionally minimal markdown:

- Bolded one-line summary
- A fields table (app, platform, kind, level, emitted time, provider issue id/url if present)
- A `Links` section for any `alert.links`
- A small `Opened by crashwatch.` footer

This format is stable but not load-bearing — feel free to edit individual issues after they're created. If you need richer templating, wrap this plugin and post-process the body yourself.

## Rate limits and cost

- GitHub throttles the REST API per-token (5,000 requests/hour for a user, 15,000 for a GitHub App). Secondary rate limits apply to write endpoints — 429 responses are retried with backoff up to `maxRetries` (default 3).
- Issue creation is a single POST per alert. A healthy crashwatch run typically produces a handful of alerts per day; you are very unlikely to touch the limit.
- If you do run into secondary rate limits, set `maxRetries: 5` and throttle the runner rather than fanning out parallel openTicket calls.

## Development

```bash
pnpm --filter @crashwatch/tracker-github-issues test
pnpm --filter @crashwatch/tracker-github-issues build
```

Tests run with `tsx` + `node --test` against recorded GitHub JSON fixtures under `src/__tests__/fixtures/`; no real API calls are made.
