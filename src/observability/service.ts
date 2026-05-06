import { appendAuditEntry } from "../audit";
import { getPlatformStateMetadata, mutateState, state } from "../state";
import type { HealthCheck, ObservabilityEvent, SignalKind } from "./index";

/** Cap on in-memory events kept in the state blob to prevent unbounded growth. */
const MAX_STATE_EVENTS = 500;

export type ObservabilitySummary = {
  signals: SignalKind[];
  eventCount: number;
  healthCheckCount: number;
  platformState: ReturnType<typeof getPlatformStateMetadata>;
};

export function listSignals(): SignalKind[] {
  return ["metrics", "logs", "traces", "audit"];
}

export function describeObservability(): ObservabilitySummary {
  return {
    signals: listSignals(),
    eventCount: state.events.length,
    healthCheckCount: state.healthChecks.length,
    platformState: getPlatformStateMetadata(),
  };
}

export function listEvents(): ObservabilityEvent[] {
  return state.events;
}

export function listHealthChecks(): HealthCheck[] {
  return state.healthChecks;
}

export function recordEvent(event: ObservabilityEvent): ObservabilityEvent {
  // Always persist audit-kind events to the durable NDJSON log first.
  if (event.kind === "audit") appendAuditEntry(event);

  // Keep a capped ring of recent events in the in-memory state blob for
  // health-check queries. Oldest entries are dropped once the cap is reached.
  mutateState((draft) => {
    draft.events.push(event);
    if (draft.events.length > MAX_STATE_EVENTS) {
      draft.events.splice(0, draft.events.length - MAX_STATE_EVENTS);
    }
  });
  return event;
}

export function upsertHealthCheck(check: HealthCheck): HealthCheck {
  mutateState((draft) => {
    const existingIndex = draft.healthChecks.findIndex((item) => item.id === check.id);
    if (existingIndex >= 0) draft.healthChecks[existingIndex] = check;
    else draft.healthChecks.push(check);
  });
  return check;
}

export const observabilityService = {
  describeObservability,
  listEvents,
  listHealthChecks,
  listSignals,
  recordEvent,
  upsertHealthCheck,
};
