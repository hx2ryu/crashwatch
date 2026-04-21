import createWebhookNotifier, {
  type WebhookNotifierOptions,
} from "@hx2ryu/crashwatch-notifier-webhook";
import type { NotifierFactory } from "@hx2ryu/crashwatch-core";

/**
 * Thin wrapper over @hx2ryu/crashwatch-notifier-webhook pre-configured for Slack
 * incoming webhooks. Exists so configs can express intent clearly
 * (`plugin: @hx2ryu/crashwatch-notifier-slack`) without repeating the template flag.
 */
export interface SlackNotifierOptions {
  webhookUrl: string;
  channel?: string;  // cosmetic; Slack ignores this for incoming webhooks
}

const createSlackNotifier: NotifierFactory<SlackNotifierOptions> = (options) => {
  const inner: WebhookNotifierOptions = {
    url: options.webhookUrl,
    bodyTemplate: "slack-incoming-webhook",
  };
  return createWebhookNotifier(inner);
};

export default createSlackNotifier;
export { createSlackNotifier };
