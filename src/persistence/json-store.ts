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

type JsonStoreCandidate<T> = {
  source: "primary" | "temp" | "backup";
  value: T;
  mtimeMs: number;
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
    const stats = statSync(path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      source,
      value: sanitize(parsed),
      mtimeMs: stats.mtimeMs,
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

  try {
    writeFileSync(tempPath, payload, { mode: 0o600 });
    fsyncPath(tempPath);

    if (options.backupCurrentPrimary && existsSync(path)) {
      copyFileSync(path, backupPath);
      fsyncPath(backupPath);
    }

    renameSync(tempPath, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    safeUnlink(tempPath);
    throw error;
  }
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

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
