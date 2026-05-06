export type SignalKind = "metrics" | "logs" | "traces" | "audit";

export type ObservabilityLevel = "info" | "warn" | "error";

export type ObservabilityEvent = {
  kind: SignalKind;
  subjectId: string;
  message: string;
  timestamp: string;
  level?: ObservabilityLevel;
  source?: string;
  metadata?: Record<string, string>;
};

export type HealthStatus = "healthy" | "degraded" | "offline";

export type HealthCheck = {
  id: string;
  subject: string;
  component: string;
  status: HealthStatus;
  summary: string;
  checkedAt: string;
  details?: Record<string, string>;
};

export const observability = {
  signals: ["metrics", "logs", "traces", "audit"] as SignalKind[],
};

export * from "./service";
