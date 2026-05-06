import type { WorkloadSpec } from "./types";

export type QuotaReasonCode = "QUOTA_INVALID_RESOURCES" | "QUOTA_OK";

export type QuotaDecision = {
  allowed: boolean;
  reasonCode: QuotaReasonCode;
  reason: string;
};

export function evaluateQuota(workload: WorkloadSpec): QuotaDecision {
  if (workload.cpuMillicores <= 0 || workload.memoryMb <= 0) {
    return { allowed: false, reasonCode: "QUOTA_INVALID_RESOURCES", reason: "Workload must request positive CPU and memory" };
  }

  return { allowed: true, reasonCode: "QUOTA_OK", reason: "Quota check passed" };
}
