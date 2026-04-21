# Writing a notifier

A notifier is a plugin that turns an `Alert` into a message on some channel — Slack, email, webhook, PagerDuty, SMS, a dashboard, anything.

```ts
import type { Alert, Notifier, NotifierFactory, NotifyContext } from "@hx2ryu/crashwatch-core";

interface MyOptions { token: string }

const factory: NotifierFactory<MyOptions> = ({ token }): Notifier => ({
  id: "my-notifier",
  async notify(alert: Alert, ctx: NotifyContext): Promise<void> {
    // call your API; throw on unrecoverable failure so the runner logs it.
  },
});

export default factory;
```

## Responsibilities

- **Formatting.** Turn the generic `Alert` into whatever the destination accepts. Keep the mapping side-effect free so it can be unit tested.
- **Retries.** One retry at most, with a short backoff. crashwatch will run again on the next schedule tick; avoid hammering.
- **Rate-limit awareness.** If your destination 429s, back off and don't throw — future ticks will recover.

## What you get

The `NotifyContext` includes:
- `appName` — redundant with `alert.appName` but handy for templating
- `runId` — ISO timestamp of the run; correlate multiple alerts from the same tick
- `options` — anything config passed in

## Non-goals

- Notifiers do not deduplicate alerts themselves. The core's detector emits one alert per transition; if you see the same alert twice in a short interval, that's a detector bug.
- Notifiers do not open tickets. Use a tracker plugin for that.
