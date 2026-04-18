import type { Alert } from "./types.js";

/**
 * Delivers alerts to a destination (Slack, webhook, email, PagerDuty, etc.).
 *
 * Notifiers are fire-and-forget from the core's perspective: they throw on
 * unrecoverable failure so the runner can log it, but do not block detection
 * of other alerts.
 */
export interface Notifier {
  /** Stable short id, e.g. "webhook", "slack". */
  readonly id: string;

  notify(alert: Alert, ctx: NotifyContext): Promise<void>;
}

export interface NotifyContext {
  /** App the alert is for — already embedded in the alert but passed for convenience. */
  appName: string;
  /** Run id (usually wall-clock ISO) for correlation in logs/stores. */
  runId: string;
  /** Arbitrary key/value from config for the notifier (channel, template). */
  options: Record<string, unknown>;
}

export type NotifierFactory<TOptions = unknown> = (
  options: TOptions,
) => Notifier | Promise<Notifier>;
