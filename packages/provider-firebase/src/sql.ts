/**
 * Parameterized SQL templates for the Firebase Crashlytics BigQuery export.
 *
 * Schema reference:
 *   https://firebase.google.com/docs/crashlytics/bigquery-export
 *
 * Column names intentionally not abstracted into an ORM — the schema is
 * small, stable, and inspecting the raw SQL is the fastest way to debug.
 */

/**
 * Issue-level aggregation over a time window.
 * Returns one row per unique `issue_id`.
 */
export const LIST_ISSUES_SQL = `
SELECT
  issue_id,
  ANY_VALUE(issue_title) AS issue_title,
  ANY_VALUE(issue_subtitle) AS issue_subtitle,
  COUNT(*) AS events,
  COUNT(DISTINCT user.id) AS impacted_users,
  COUNTIF(is_fatal) AS fatal_events,
  MIN(event_timestamp) AS first_seen,
  MAX(event_timestamp) AS last_seen,
  ANY_VALUE(application.display_version) AS last_seen_version
FROM \`{TABLE}\`
WHERE event_timestamp BETWEEN @from AND @to
GROUP BY issue_id
ORDER BY events DESC
LIMIT @limit
`;

/**
 * One-issue detail. Same shape as LIST_ISSUES_SQL but scoped to one id.
 */
export const GET_ISSUE_SQL = `
SELECT
  issue_id,
  ANY_VALUE(issue_title) AS issue_title,
  ANY_VALUE(issue_subtitle) AS issue_subtitle,
  COUNT(*) AS events,
  COUNT(DISTINCT user.id) AS impacted_users,
  COUNTIF(is_fatal) AS fatal_events,
  MIN(event_timestamp) AS first_seen,
  MAX(event_timestamp) AS last_seen,
  ANY_VALUE(application.display_version) AS last_seen_version
FROM \`{TABLE}\`
WHERE issue_id = @issueId
  AND event_timestamp BETWEEN @from AND @to
GROUP BY issue_id
LIMIT 1
`;

/**
 * Raw events with enough detail to populate CrashEvent.
 * Limited to the columns we actually map; star-select is wasteful on BQ.
 */
export const LIST_EVENTS_SQL = `
SELECT
  event_id,
  event_timestamp,
  issue_id,
  is_fatal,
  application.display_version AS app_version,
  device.manufacturer AS device_manufacturer,
  device.model AS device_model,
  operating_system.display_version AS os_version,
  operating_system.name AS os_name,
  exceptions,
  breadcrumbs,
  blame_frame,
  memory_used,
  disk_used
FROM \`{TABLE}\`
WHERE event_timestamp BETWEEN @from AND @to
  {ISSUE_FILTER}
ORDER BY event_timestamp DESC
LIMIT @limit
`;

export const TOP_VERSIONS_SQL = `
SELECT
  application.display_version AS dimension,
  COUNT(*) AS events,
  COUNT(DISTINCT user.id) AS impacted_users
FROM \`{TABLE}\`
WHERE event_timestamp BETWEEN @from AND @to
GROUP BY dimension
ORDER BY events DESC
LIMIT @limit
`;

export const TOP_DEVICES_SQL = `
SELECT
  CONCAT(device.manufacturer, ' ', device.model) AS dimension,
  COUNT(*) AS events,
  COUNT(DISTINCT user.id) AS impacted_users
FROM \`{TABLE}\`
WHERE event_timestamp BETWEEN @from AND @to
GROUP BY dimension
ORDER BY events DESC
LIMIT @limit
`;

export const TOP_OS_SQL = `
SELECT
  CONCAT(operating_system.name, ' ', operating_system.display_version) AS dimension,
  COUNT(*) AS events,
  COUNT(DISTINCT user.id) AS impacted_users
FROM \`{TABLE}\`
WHERE event_timestamp BETWEEN @from AND @to
GROUP BY dimension
ORDER BY events DESC
LIMIT @limit
`;

/**
 * BigQuery requires table names to be baked into the SQL (they cannot be
 * bound as parameters). We still validate the identifier so a malicious
 * config cannot turn a query into an injection vector.
 */
export function renderTable(sql: string, table: string): string {
  assertValidTableId(table);
  return sql.replace("{TABLE}", table);
}

export function assertValidTableId(table: string): void {
  // Accept project.dataset.table (BigQuery fully qualified) only.
  // Identifiers must be [A-Za-z0-9_-] and at most 1024 chars total.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(table)) {
    throw new Error(
      `Invalid BigQuery table id: ${JSON.stringify(table)}. ` +
        `Expected "<project>.<dataset>.<table>".`,
    );
  }
}
