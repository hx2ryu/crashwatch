# @crashwatch/provider-sentry

Sentry provider for [crashwatch](../../README.md).

## What this queries

Sentry publishes a stable public REST API, so this provider talks to it directly — no export pipeline required. Requests go to:

```
https://sentry.io/api/0/projects/{org}/{project}/issues/
https://sentry.io/api/0/projects/{org}/{project}/events/
https://sentry.io/api/0/organizations/{org}/issues/{id}/
https://sentry.io/api/0/organizations/{org}/issues/{id}/events/
```

Pagination follows Sentry's `Link: rel="next"; results="true"` cursors; 429 / 503 responses are retried with jittered exponential backoff, honouring `Retry-After` when present.

If you run self-hosted Sentry, pass `baseUrl: "https://sentry.mycompany.com/api/0"` in the provider options.

## Install

```bash
pnpm add @crashwatch/provider-sentry
```

There are no extra native or cloud-SDK dependencies; the provider uses the built-in `fetch` shipped with Node ≥ 18.

## Authenticate

1. Go to **https://sentry.io/settings/account/api/auth-tokens/** (user auth token) or **Organization Settings → Auth Tokens** (org-scoped token).
2. Create a token with the following scopes:
   - `event:read`
   - `project:read`
3. Export the token in your environment:

   ```bash
   export SENTRY_AUTH_TOKEN="sntrys_..."
   ```

Tokens are sent as `Authorization: Bearer <token>`.

## Configure

```yaml
version: 1
providers:
  - id: sentry
    plugin: "@crashwatch/provider-sentry"
    options:
      authToken: "${SENTRY_AUTH_TOKEN}"
      org: "my-org"
      defaultProject: "web-frontend"   # optional; apps can override
      defaultWindowHours: 24            # optional; default 24
      pageSize: 100                     # optional; Sentry max is 100

apps:
  - name: example-app
    platforms:
      android:
        providerOptions:
          project: "mobile-android"
          environment: "production"
      ios:
        providerOptions:
          project: "mobile-ios"
          environment: "production"
    providers: [sentry]
```

### Per-app options

| Field | Required | Notes |
|---|---|---|
| `project` | unless `defaultProject` is set | Sentry project slug. |
| `org` | no | Override the top-level `org` for this app only. |
| `environment` | no | Passed to Sentry's `environment` query param; scopes issues/events to e.g. `production` vs `staging`. |

## Capabilities

| Capability | Supported |
|---|---|
| `listIssues` | ✅ |
| `listEvents` | ✅ |
| `pagination` | ✅ (cursor-based) |
| `signals` | ✅ (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`) |
| `getReport` | ❌ |

Mapping of Sentry issue fields to core types:

| Sentry | crashwatch |
|---|---|
| `status: unresolved` | `state: "open"` |
| `status: resolved` | `state: "closed"` |
| `status: ignored` | `state: "muted"` |
| `status: reprocessing` / other | `state: "unknown"` |
| `isRegressed: true` | `signals` includes `SIGNAL_REGRESSED` |
| `firstSeen` inside the current window | `signals` includes `SIGNAL_EARLY` |
| `isUnhandled: true` or `level: "fatal"` | `errorType: "fatal"` |
| `count`, `userCount` | `recentEvents`, `recentImpactedUsers` |

The default detector understands both signals, so regressed issues will trigger alerts directly even without a 7-day history buffer.

## Rate limits and cost

- Sentry throttles API traffic per-org; the client backs off automatically on 429 and re-tries up to `maxRetries` (default 3) times.
- Use `pageSize: 100` (the maximum) plus a bounded `limit` on the caller side to minimise round-trips.
- For very high-volume orgs, consider scoping to a single `environment` or passing `query: "is:unresolved"` via a custom filter.

## Development

```bash
pnpm --filter @crashwatch/provider-sentry test
pnpm --filter @crashwatch/provider-sentry build
```

Tests run with `tsx` + `node --test` against recorded Sentry JSON fixtures under `src/__tests__/fixtures/`; no real API calls are made.
