import type {
  Alert,
  Notifier,
  NotifierFactory,
  NotifyContext,
} from "@crashwatch/core";

export interface WebhookNotifierOptions {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  /**
   * Template for the body. If omitted, the alert is sent verbatim as JSON.
   * When a template string, supports the literals:
   *   - "slack-incoming-webhook" — formats a Slack-compatible payload.
   */
  bodyTemplate?: "slack-incoming-webhook" | "raw";
  /** Abort the request if it takes longer than this (ms). */
  timeoutMs?: number;
}

const createWebhookNotifier: NotifierFactory<WebhookNotifierOptions> = (
  options,
) => new WebhookNotifier(options);

export default createWebhookNotifier;
export { createWebhookNotifier };

class WebhookNotifier implements Notifier {
  readonly id = "webhook";

  constructor(private readonly options: WebhookNotifierOptions) {
    if (!options.url) {
      throw new Error("webhook notifier: 'url' option is required.");
    }
  }

  async notify(alert: Alert, _ctx: NotifyContext): Promise<void> {
    const body = this.formatBody(alert);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );
    try {
      const res = await fetch(this.options.url, {
        method: this.options.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.headers ?? {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`webhook ${res.status} ${res.statusText}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatBody(alert: Alert): string {
    if (this.options.bodyTemplate === "slack-incoming-webhook") {
      return JSON.stringify(toSlackPayload(alert));
    }
    return JSON.stringify(alert);
  }
}

function toSlackPayload(alert: Alert): unknown {
  const emoji =
    alert.level === "critical" ? ":rotating_light:" :
    alert.level === "warning" ? ":warning:" :
    ":information_source:";
  const links = (alert.links ?? []).map((l) => `<${l.url}|${l.label}>`).join("  ");
  return {
    text: `${emoji} ${alert.title}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${emoji} *${alert.title}*\n${alert.summary}` },
      },
      ...(links
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: links }] }]
        : []),
    ],
  };
}
