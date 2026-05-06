import type { NodeSpec, WorkloadSpec } from "./types";

export type PolicyReasonCode =
  | "POLICY_INVALID_REPLICAS"
  | "POLICY_NO_REGISTERED_NODES"
  | "POLICY_ONLY_UNTRUSTED_NODES"
  | "POLICY_OK";

export type PolicyDecision = {
  allowed: boolean;
  reasonCode: PolicyReasonCode;
  reason: string;
};

export function evaluatePlacementPolicy(workload: WorkloadSpec, nodes: NodeSpec[]): PolicyDecision {
  if (workload.replicas < 1) {
    return { allowed: false, reasonCode: "POLICY_INVALID_REPLICAS", reason: "Workload must request at least one replica" };
  }

  if (nodes.length === 0) {
    return { allowed: false, reasonCode: "POLICY_NO_REGISTERED_NODES", reason: "No nodes are registered" };
  }

  const trustEligibleNodes = nodes.filter((node) => node.trustState !== "quarantined" && node.trustState !== "revoked" && node.trustState !== "expired");
  if (trustEligibleNodes.length === 0) {
    return {
      allowed: false,
      reasonCode: "POLICY_ONLY_UNTRUSTED_NODES",
      reason: "No trust-eligible nodes available (all nodes are quarantined, revoked, or expired)",
    };
  }

  return { allowed: true, reasonCode: "POLICY_OK", reason: "Placement policy passed" };
}
