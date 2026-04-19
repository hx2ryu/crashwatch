# @crashwatch/notifier-slack

Slack Incoming Webhook notifier for [crashwatch](../../README.md).

## What this is

A thin convenience wrapper around [`@crashwatch/notifier-webhook`](../notifier-webhook) that pre-selects the `slack-incoming-webhook` body template. It exists so configs can express intent clearly — `plugin: "@crashwatch/notifier-slack"` — rather than repeating the template flag on a generic webhook.

The two packages produce identical HTTP traffic; pick whichever reads more naturally in your config.

## Install

```bash
pnpm add @crashwatch/notifier-slack
```

`@crashwatch/notifier-webhook` comes along as a transitive dep; `@crashwatch/core` is a peer. Requires Node ≥ 18.

## Configure

```yaml
version: 1
notifiers:
  - id: slack
    plugin: "@crashwatch/notifier-slack"
    options:
      webhookUrl: "${SLACK_WEBHOOK_URL}"
      channel: "#crashes"   # cosmetic only; Slack Incoming Webhooks
                             # route by the URL, not the channel field
```

### Options

| Field | Required | Notes |
|---|---|---|
| `webhookUrl` | yes | Your Slack Incoming Webhook URL (`https://hooks.slack.com/services/...`). Env expansion via `${VAR}` applies. |
| `channel` | no | Cosmetic; Slack ignores it for incoming webhooks because the channel is baked into the URL. |

## Advanced

If you need custom headers, a different method, or `raw` output for a Slack-compatible Block Kit endpoint that is not a standard Incoming Webhook, drop down to [`@crashwatch/notifier-webhook`](../notifier-webhook) and set `bodyTemplate: slack-incoming-webhook` (or `raw`) yourself.

## Development

```bash
pnpm --filter @crashwatch/notifier-slack test
pnpm --filter @crashwatch/notifier-slack build
```
