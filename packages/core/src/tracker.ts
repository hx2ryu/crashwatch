import type { Alert, Issue } from "./types.js";

/**
 * Optional adapter that turns alerts into tickets in an external issue
 * tracker (Jira, Linear, GitHub Issues, ...). Not required by MVP.
 */
export interface IssueTracker {
  readonly id: string;

  /** Returns the external ticket identifier/URL, or null if deduplicated. */
  openTicket(alert: Alert, ctx: TrackerContext): Promise<TicketRef | null>;

  /** Look up an existing ticket that was opened for the same crash issue. */
  findTicket?(issue: Issue, ctx: TrackerContext): Promise<TicketRef | null>;
}

export interface TrackerContext {
  appName: string;
  options: Record<string, unknown>;
}

export interface TicketRef {
  id: string;
  url: string;
  status?: string;
}

export type TrackerFactory<TOptions = unknown> = (
  options: TOptions,
) => IssueTracker | Promise<IssueTracker>;
