/**
 * Durable, queryable audit log.
 *
 * Events are written as newline-delimited JSON (NDJSON) to a file that is
 * separate from the state blob so that the state blob does not grow without
 * bound and so that audit entries survive even a state-reset.
 *
 * Path resolution (highest priority first):
 *   1. NEXUS_CLOUD_AUDIT_PATH env var (absolute or relative to cwd)
 *   2. <cwd>/data/audit.ndjson
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { ObservabilityEvent } from "../observability";

// ── Filter ────────────────────────────────────────────────────────────────────

export type AuditFilter = {
  /** Match events whose subjectId equals this value. */
  subjectId?: string;
  /** Match events whose source equals this value. */
  source?: string;
  /** Match events at this level (info | warn | error). */
  level?: string;
  /** Match events of this signal kind (audit | logs | metrics | traces). */
  kind?: string;
  /** ISO-8601 lower bound, inclusive. */
  from?: string;
  /** ISO-8601 upper bound, inclusive. */
  to?: string;
  /** Match events whose metadata.eventType equals this value. */
  eventType?: string;
  /** Match events whose metadata.action equals this value. */
  action?: string;
  /** Match events whose metadata.actor equals this value. */
  actor?: string;
  /** Maximum number of results to return (default 100, max 1000). */
  limit?: number;
};

// ── Path resolution ───────────────────────────────────────────────────────────

export function resolveAuditLogPath(): string {
  const override = process.env.NEXUS_CLOUD_AUDIT_PATH?.trim();
  if (!override) return join(process.cwd(), "data", "audit.ndjson");
  return isAbsolute(override) ? override : join(process.cwd(), override);
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Appends a single audit entry to the NDJSON log file.
 * This is a best-effort write: if the file system is unavailable the error is
 * swallowed so that a log write never degrades a business operation.
 */
export function appendAuditEntry(event: ObservabilityEvent): void {
  const logPath = resolveAuditLogPath();
  try {
    ensureParentDir(logPath);
    appendFileSync(logPath, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // best-effort: never propagate a log-write failure to the caller
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Reads and filters the durable audit log.
 * Returns entries in reverse-chronological order (newest first).
 * An empty array is returned when the log file does not yet exist.
 */
export function queryAuditLog(filter: AuditFilter = {}): ObservabilityEvent[] {
  const logPath = resolveAuditLogPath();
  if (!existsSync(logPath)) return [];

  let entries: ObservabilityEvent[];
  try {
    entries = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ObservabilityEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is ObservabilityEvent => e !== null);
  } catch {
    return [];
  }

  if (filter.subjectId !== undefined) entries = entries.filter((e) => e.subjectId === filter.subjectId);
  if (filter.source !== undefined) entries = entries.filter((e) => e.source === filter.source);
  if (filter.level !== undefined) entries = entries.filter((e) => e.level === filter.level);
  if (filter.kind !== undefined) entries = entries.filter((e) => e.kind === filter.kind);
  if (filter.from !== undefined) entries = entries.filter((e) => e.timestamp >= filter.from!);
  if (filter.to !== undefined) entries = entries.filter((e) => e.timestamp <= filter.to!);
  if (filter.eventType !== undefined) entries = entries.filter((e) => e.metadata?.eventType === filter.eventType);
  if (filter.action !== undefined) entries = entries.filter((e) => e.metadata?.action === filter.action);
  if (filter.actor !== undefined) entries = entries.filter((e) => e.metadata?.actor === filter.actor);

  // newest first
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const limit = Math.min(filter.limit ?? 100, 1000);
  return entries.slice(0, limit);
}
