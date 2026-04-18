import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Alert, Snapshot } from "./types.js";

/**
 * Append-only store of snapshots + alert records. The default implementation
 * writes JSONL to disk — simple, inspectable, diff-able. Back it with S3,
 * SQLite, or a managed TSDB by implementing the same interface.
 */
export interface SnapshotStore {
  appendSnapshot(snapshot: Snapshot): Promise<void>;
  appendAlert(alert: Alert): Promise<void>;
  readRecentSnapshots(appName: string, limit: number): Promise<Snapshot[]>;
}

export class JsonlSnapshotStore implements SnapshotStore {
  constructor(
    private readonly baseDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async appendSnapshot(snapshot: Snapshot): Promise<void> {
    const path = this.snapshotPath(snapshot.appName);
    await ensureDir(path);
    await appendFile(path, JSON.stringify(snapshot) + "\n", "utf8");
  }

  async appendAlert(alert: Alert): Promise<void> {
    const path = this.alertPath(alert.appName);
    await ensureDir(path);
    await appendFile(path, JSON.stringify(alert) + "\n", "utf8");
  }

  async readRecentSnapshots(
    appName: string,
    limit: number,
  ): Promise<Snapshot[]> {
    const path = this.snapshotPath(appName);
    let data: string;
    try {
      data = await readFile(path, "utf8");
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const lines = data.split("\n").filter((l) => l.length > 0);
    const slice = lines.slice(-limit);
    return slice.map((l) => JSON.parse(l) as Snapshot);
  }

  private snapshotPath(appName: string): string {
    return `${this.baseDir}/snapshots/${safe(appName)}.jsonl`;
  }

  private alertPath(appName: string): string {
    return `${this.baseDir}/alerts/${safe(appName)}.jsonl`;
  }
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  );
}
