import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export type JsonStoreMetadata = {
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastWriteAt: string | null;
  ageSeconds: number | null;
};

export type JsonStoreRecovery = {
  source: "primary" | "temp" | "backup" | "empty";
  recovered: boolean;
  repaired: boolean;
  recoveredAt: string;
};

/** The replacement happened, but its directory sync did not complete. */
export class JsonStorePostReplaceError extends Error {
  constructor(public readonly path: string, cause: unknown) {
    super(`JSON store replacement needs reconciliation: ${path}`, { cause });
  }
}

let afterReplaceHookForTests: ((path: string) => void) | null = null;

export function setJsonStoreAfterReplaceHookForTests(hook: ((path: string) => void) | null): void {
  afterReplaceHookForTests = hook;
}

type JsonStoreCandidate<T> = {
  source: "primary" | "temp" | "backup";
  value: T;
};

export function resolveJsonStorePath(defaultRelativePath: string, envVarName?: string): string {
  const override = envVarName ? process.env[envVarName]?.trim() : undefined;
  if (!override) return join(process.cwd(), defaultRelativePath);
  return isAbsolute(override) ? override : join(process.cwd(), override);
}

function safeUnlink(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // Best effort cleanup.
  }
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readCandidate<T>(
  path: string,
  source: JsonStoreCandidate<T>["source"],
  sanitize: (value: unknown) => T,
): JsonStoreCandidate<T> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      source,
      value: sanitize(parsed),
    };
  } catch {
    return null;
  }
}

export function writeJsonStoreAtomic<T>(
  path: string,
  value: T,
  options: { backupCurrentPrimary: boolean },
): void {
  const tempPath = `${path}.tmp`;
  const backupPath = `${path}.bak`;
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let replaced = false;

  try {
    if (options.backupCurrentPrimary && existsSync(path)) {
      copyFileSync(path, backupPath);
      fsyncPath(backupPath);
    }

    writeFileSync(tempPath, payload, { mode: 0o600 });
    fsyncPath(tempPath);
    renameSync(tempPath, path);
    replaced = true;
    afterReplaceHookForTests?.(path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    safeUnlink(tempPath);
    if (replaced) throw new JsonStorePostReplaceError(path, error);
    throw error;
  }
}

export function isJsonStoreSnapshotCurrent<T>(path: string, expected: T): boolean {
  try {
    return JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

/** Retry durability after a post-replacement directory sync error. */
export function syncJsonStoreSnapshot(path: string): void {
  fsyncPath(path);
  fsyncDirectory(dirname(path));
}

export function loadJsonStoreWithRecovery<T>(
  path: string,
  emptyValue: T,
  sanitize: (value: unknown) => T,
): { value: T; recovery: JsonStoreRecovery } {
  const tempPath = `${path}.tmp`;
  const candidates = [
    readCandidate(path, "primary", sanitize),
    readCandidate(tempPath, "temp", sanitize),
    readCandidate(`${path}.bak`, "backup", sanitize),
  ].filter((candidate): candidate is JsonStoreCandidate<T> => candidate !== null);

  if (candidates.length === 0) {
    return {
      value: emptyValue,
      recovery: {
        source: "empty",
        recovered: false,
        repaired: false,
        recoveredAt: new Date().toISOString(),
      },
    };
  }

  // A valid primary is the committed value regardless of backup mtimes.
  // A temp file is considered only when the primary is missing or invalid.
  const priority = { primary: 0, temp: 1, backup: 2 } as const;
  candidates.sort((a, b) => priority[a.source] - priority[b.source]);
  const winner = candidates[0];
  if (!winner) {
    return {
      value: emptyValue,
      recovery: {
        source: "empty",
        recovered: false,
        repaired: false,
        recoveredAt: new Date().toISOString(),
      },
    };
  }

  let repaired = false;
  if (winner.source !== "primary" || !existsSync(path)) {
    try {
      writeJsonStoreAtomic(path, winner.value, { backupCurrentPrimary: false });
      repaired = true;
    } catch {
      repaired = false;
    }
  }

  if (winner.source !== "temp") {
    safeUnlink(tempPath);
  }

  return {
    value: winner.value,
    recovery: {
      source: winner.source,
      recovered: winner.source !== "primary",
      repaired,
      recoveredAt: new Date().toISOString(),
    },
  };
}

export function getJsonStoreMetadata(path: string): JsonStoreMetadata {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      sizeBytes: 0,
      lastWriteAt: null,
      ageSeconds: null,
    };
  }

  const stats = statSync(path);
  return {
    path,
    exists: true,
    sizeBytes: stats.size,
    lastWriteAt: stats.mtime.toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000)),
  };
}
