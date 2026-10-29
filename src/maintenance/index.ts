// Operator-set platform maintenance.
//
// A maintenance record marks one platform part (a tool id or a domain) as
// deliberately offline. The proxy reads these — surfaced on /api/v1/routes and
// /api/v1/maintenance — and serves the maintenance page instead of proxying.
//
// Maintenance is explicit on both ends: an operator starts it and an operator
// clears it. `expectedEndAt` is display-only (it drives the page's countdown);
// the window does not auto-expire, because "the countdown hit zero" is not the
// same fact as "the operator confirmed it is back".

import { recordEvent } from "../observability";
import { type MaintenanceRecord, mutateState, state } from "../state";

export type SetMaintenanceInput = {
  subjectId: string;
  part: string;
  reason?: string;
  expectedEndAt?: string;
  setBy: string;
};

function now(): string {
  return new Date().toISOString();
}

/**
 * Put a part into maintenance, or update an existing window. The original
 * `startedAt` is preserved across updates so the "in maintenance since" line
 * stays truthful when an operator only revises the reason or the end time.
 */
export function setMaintenance(input: SetMaintenanceInput): MaintenanceRecord {
  const wasActive = state.maintenance.some((m) => m.subjectId === input.subjectId);
  const record = mutateState((draft) => {
    const existing = draft.maintenance.find((m) => m.subjectId === input.subjectId);
    const rec: MaintenanceRecord = {
      subjectId: input.subjectId,
      part: input.part,
      startedAt: existing?.startedAt ?? now(),
      setBy: input.setBy,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.expectedEndAt !== undefined ? { expectedEndAt: input.expectedEndAt } : {}),
    };
    const idx = draft.maintenance.findIndex((m) => m.subjectId === input.subjectId);
    if (idx >= 0) draft.maintenance[idx] = rec;
    else draft.maintenance.push(rec);
    return rec;
  });
  recordEvent({
    kind: "audit",
    level: "warn",
    source: "maintenance",
    subjectId: record.subjectId,
    message: `Maintenance ${wasActive ? "updated" : "started"} for ${record.part} by ${record.setBy}${record.reason ? `: ${record.reason}` : ""}`,
    timestamp: now(),
  });
  return record;
}

/** End a maintenance window. Returns false when the part was not in maintenance. */
export function clearMaintenance(subjectId: string, clearedBy: string): boolean {
  const removed = mutateState((draft) => {
    const idx = draft.maintenance.findIndex((m) => m.subjectId === subjectId);
    if (idx < 0) return null;
    const [gone] = draft.maintenance.splice(idx, 1);
    return gone ?? null;
  });
  if (!removed) return false;
  recordEvent({
    kind: "audit",
    level: "info",
    source: "maintenance",
    subjectId,
    message: `Maintenance ended for ${removed.part} by ${clearedBy}`,
    timestamp: now(),
  });
  return true;
}

export function getMaintenance(subjectId: string): MaintenanceRecord | null {
  return state.maintenance.find((m) => m.subjectId === subjectId) ?? null;
}

export function listMaintenance(): readonly MaintenanceRecord[] {
  return state.maintenance;
}

export function isUnderMaintenance(subjectId: string): boolean {
  return state.maintenance.some((m) => m.subjectId === subjectId);
}
