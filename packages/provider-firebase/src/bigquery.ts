/**
 * Thin wrapper over @google-cloud/bigquery that is loaded lazily.
 *
 * We deliberately do not `import` the SDK statically so that:
 *   - `@hx2ryu/crashwatch-provider-firebase` can be installed without the heavy
 *     GCP transitive deps when BigQuery is not in use.
 *   - Runtime errors about the SDK surface the install-hint clearly.
 */

export interface BigqueryClientOptions {
  projectId?: string;
  credentials?: string | object;
}

export interface QueryRow {
  [key: string]: unknown;
}

export interface BigqueryClient {
  query(
    sql: string,
    params: Record<string, unknown>,
    types?: Record<string, string>,
  ): Promise<QueryRow[]>;
}

export async function createBigqueryClient(
  opts: BigqueryClientOptions,
): Promise<BigqueryClient> {
  let BigQueryCtor: new (opts: unknown) => BigQueryShape;
  try {
    const mod = await import("@google-cloud/bigquery");
    // The SDK's native shape is wider than the handful of methods we use;
    // narrow via `unknown` because a direct cast is not structurally sound.
    BigQueryCtor = (mod as unknown as { BigQuery: new (opts: unknown) => BigQueryShape }).BigQuery;
  } catch (err) {
    throw new Error(
      "@hx2ryu/crashwatch-provider-firebase requires @google-cloud/bigquery in " +
        "bigquery mode. Install it:\n" +
        "  pnpm add @google-cloud/bigquery\n\n" +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const sdkOptions: Record<string, unknown> = {};
  if (opts.projectId) sdkOptions.projectId = opts.projectId;
  if (opts.credentials) {
    if (typeof opts.credentials === "string") sdkOptions.keyFilename = opts.credentials;
    else sdkOptions.credentials = opts.credentials;
  }
  const client = new BigQueryCtor(sdkOptions);

  return {
    async query(sql, params, types) {
      const [rows] = await client.query({
        query: sql,
        params,
        types,
        useLegacySql: false,
      });
      return rows as QueryRow[];
    },
  };
}

/** Minimal shape we rely on from the SDK. */
interface BigQueryShape {
  query(options: {
    query: string;
    params?: Record<string, unknown>;
    types?: Record<string, string>;
    useLegacySql?: boolean;
  }): Promise<[unknown[]]>;
}
