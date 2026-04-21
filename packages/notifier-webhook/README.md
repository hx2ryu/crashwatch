# @hx2ryu/crashwatch-notifier-webhook

Generic HTTP webhook notifier for [crashwatch](../../README.md). POSTs each alert as JSON to a configured URL.

## What this does

On every `Alert` produced by the detector, the notifier performs one HTTP request:

- Method: `POST` (or `PUT`, configurable).
- Body: the serialised alert — either the `Alert` object verbatim, or reshaped by a body template (see below).
- Headers: `content-type: application/json` plus any custom headers you pass.
- Timeout: 10 s by default, configurable; request is aborted via `AbortController` when exceeded.
- Non-2xx responses throw, which the CLI logs to stderr and moves on.

No external HTTP client dependency — uses Node's built-in `fetch`.

## Install

```bash
pnpm add @hx2ryu/crashwatch-notifier-webhook
```

Requires Node ≥ 18. `@hx2ryu/crashwatch-core` is a peer dependency.

## Configure

```yaml
version: 1
notifiers:
  - id: ops-webhook
    plugin: "@hx2ryu/crashwatch-notifier-webhook"
    options:
      url: "${CRASHWATCH_WEBHOOK_URL}"
      method: POST                       # optional; default POST
      bodyTemplate: raw                  # optional; default raw
      headers:                           # optional
        authorization: "Bearer ${OPS_TOKEN}"
      timeoutMs: 10000                   # optional; default 10000

apps:
  - name: example-app
    platforms:
      web:
        providerOptions: { ... }
    notify: [ops-webhook]
```

### Options

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Destination URL. `${ENV_VAR}` and `${ENV_VAR:-default}` expand via `@hx2ryu/crashwatch-core`'s config loader, so the secret never lives in YAML. |
| `method` | no | `"POST"` (default) or `"PUT"`. |
| `bodyTemplate` | no | `"raw"` (default) sends the `Alert` JSON verbatim. `"slack-incoming-webhook"` reshapes it into a Slack-compatible `{ text, blocks: [...] }` payload with a level-based emoji and `<url|label>` links. |
| `headers` | no | Extra headers merged onto `content-type: application/json`. Env expansion applies. |
| `timeoutMs` | no | Abort the request after this many milliseconds. Default `10000`. |

### Body templates

Two templates ship today:

- **`raw`** — the default. The body is the `Alert` object as JSON. Use this for arbitrary receivers (custom intake endpoint, n8n/Zapier webhook, Grafana contact point, etc.).
- **`slack-incoming-webhook`** — formats the alert for a Slack Incoming Webhook URL, with `:rotating_light:` for `critical`, `:warning:` for `warning`, and `:information_source:` for `info`. Links from `alert.links` are rendered as a Slack context block.

Env expansion happens at config-load time on every string, including `url` and `headers`. Write `"url": "${SLACK_WEBHOOK_URL}"` and export the variable; falling back with `"${SLACK_WEBHOOK_URL:-https://example.com/test}"` also works.

## When to use this

Reach for `@hx2ryu/crashwatch-notifier-webhook` when the destination does not have a dedicated crashwatch plugin — your own intake API, a generic automation platform, Grafana, PagerDuty Events v2, Discord, etc. For Slack specifically, the convenience wrapper [`@hx2ryu/crashwatch-notifier-slack`](../notifier-slack) pre-selects the `slack-incoming-webhook` template so your config reads more intentionally; the two produce identical HTTP traffic.

## Development

```bash
pnpm --filter @hx2ryu/crashwatch-notifier-webhook test
pnpm --filter @hx2ryu/crashwatch-notifier-webhook build
```
