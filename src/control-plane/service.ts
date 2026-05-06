import { mutateState, snapshot as snapshotState, state } from "../state";
import { evaluatePlacementPolicy, type PolicyDecision } from "./policy";
import { evaluateQuota, type QuotaDecision } from "./quota";
import { upsertWorkload } from "./placement";
import { planWorkload as buildPlacementPlan } from "./scheduler";
import { registerNode as addNode } from "./registration";
import type { NodeRegistrationRequest, NodeSpec, PlacementPlan, WorkloadSpec } from "./types";

export type NodeTrustSummary = {
  total: number;
  pending: number;
  verified: number;
  trusted: number;
  quarantined: number;
  revoked: number;
  expired: number;
};

export type ControlPlaneSnapshot = ReturnType<typeof snapshotState>;

export type ControlPlanePlanningSuccess = {
  ok: true;
  status: 200 | 503;
  workload: WorkloadSpec;
  plan: PlacementPlan;
  policy: PolicyDecision;
  quota: QuotaDecision;
  warning?: string;
};

export type ControlPlanePlanningFailure = {
  ok: false;
  status: 409 | 422;
  error: string;
  policy: PolicyDecision;
  quota?: QuotaDecision;
};

export type ControlPlanePlanningResult = ControlPlanePlanningSuccess | ControlPlanePlanningFailure;

export function listNodes(): NodeSpec[] {
  return state.nodes;
}

export function listWorkloads(): WorkloadSpec[] {
  return state.workloads;
}

export function snapshot(): ControlPlaneSnapshot {
  return snapshotState();
}

export function registerNode(input: NodeRegistrationRequest): NodeSpec {
  return addNode(state.nodes, input);
}

export function getNode(nodeId: string): NodeSpec | null {
  return state.nodes.find((node) => node.id === nodeId) ?? null;
}

function nodeTrustTtlHours(): number {
  const raw = Number(process.env.NEXUS_CLOUD_NODE_TRUST_TTL_HOURS ?? "168");
  return Number.isFinite(raw) ? Math.max(1, raw) : 168;
}

function trustExpiryDate(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

export function promoteNodeTrust(nodeId: string): NodeSpec | null {
  let updated: NodeSpec | null = null;
  const now = new Date().toISOString();

  mutateState((draft) => {
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    node.trustState = "trusted";
    node.trustUpdatedAt = now;
    node.trustExpiresAt = trustExpiryDate(nodeTrustTtlHours());
    node.status = node.status === "offline" ? "pending" : node.status;
    updated = { ...node, labels: { ...node.labels }, capacity: { ...node.capacity } };
  });

  return updated;
}

export function quarantineNodeTrust(nodeId: string): NodeSpec | null {
  let updated: NodeSpec | null = null;
  const now = new Date().toISOString();

  mutateState((draft) => {
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    node.trustState = "quarantined";
    node.trustUpdatedAt = now;
    node.status = node.status === "ready" ? "draining" : node.status;
    updated = { ...node, labels: { ...node.labels }, capacity: { ...node.capacity } };
  });

  return updated;
}

export function revokeNodeTrust(nodeId: string): NodeSpec | null {
  let updated: NodeSpec | null = null;
  const now = new Date().toISOString();

  mutateState((draft) => {
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    node.trustState = "revoked";
    node.trustUpdatedAt = now;
    node.status = "offline";
    updated = { ...node, labels: { ...node.labels }, capacity: { ...node.capacity } };
  });

  return updated;
}

export function describeNodeTrustSummary(): NodeTrustSummary {
  const trustStates = state.nodes.map((node) => node.trustState);
  return {
    total: trustStates.length,
    pending: trustStates.filter((trustState) => trustState === "pending").length,
    verified: trustStates.filter((trustState) => trustState === "verified").length,
    trusted: trustStates.filter((trustState) => trustState === "trusted").length,
    quarantined: trustStates.filter((trustState) => trustState === "quarantined").length,
    revoked: trustStates.filter((trustState) => trustState === "revoked").length,
    expired: trustStates.filter((trustState) => trustState === "expired").length,
  };
}

export function applyNodeTrustExpiry(nowAt = new Date()): number {
  const nowIso = nowAt.toISOString();
  let expired = 0;

  mutateState((draft) => {
    for (const node of draft.nodes) {
      if (!node.trustExpiresAt) continue;
      if (node.trustState === "revoked" || node.trustState === "expired") continue;
      const expiryMs = Date.parse(node.trustExpiresAt);
      if (Number.isNaN(expiryMs)) continue;
      if (expiryMs > nowAt.getTime()) continue;

      node.trustState = "expired";
      node.trustUpdatedAt = nowIso;
      node.status = node.status === "ready" ? "pending" : node.status;
      expired += 1;
    }
  });

  return expired;
}

export function planWorkload(workload: WorkloadSpec): ControlPlanePlanningResult {
  const policy = evaluatePlacementPolicy(workload, state.nodes);
  if (!policy.allowed) {
    return { ok: false, status: 409, error: policy.reason, policy };
  }

  const quota = evaluateQuota(workload);
  if (!quota.allowed) {
    return { ok: false, status: 422, error: quota.reason, policy, quota };
  }

  const persisted = upsertWorkload(state.workloads, workload);
  const plan = buildPlacementPlan(state.nodes, persisted);

  if (plan.decisions.length === 0) {
    return {
      ok: true,
      status: 503,
      workload: persisted,
      plan,
      policy,
      quota,
      warning: "No trust-eligible ready nodes available",
    };
  }

  return {
    ok: true,
    status: 200,
    workload: persisted,
    plan,
    policy,
    quota,
  };
}

export const controlPlaneService = {
  applyNodeTrustExpiry,
  describeNodeTrustSummary,
  getNode,
  listNodes,
  listWorkloads,
  planWorkload,
  promoteNodeTrust,
  quarantineNodeTrust,
  registerNode,
  revokeNodeTrust,
  snapshot,
};
