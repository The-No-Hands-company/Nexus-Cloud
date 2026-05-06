import type { NodeRegistrationRequest, NodeSpec } from "./types";
import { mutateState } from "../state";

function trustExpiryDate(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

function nodeTrustTtlHours(): number {
  const raw = Number(process.env.NEXUS_CLOUD_NODE_TRUST_TTL_HOURS ?? "168");
  return Number.isFinite(raw) ? Math.max(1, raw) : 168;
}

export function createRegisteredNode(input: NodeRegistrationRequest): NodeSpec {
  const now = new Date().toISOString();
  return {
    id: `node_${crypto.randomUUID()}`,
    name: input.name,
    region: input.region,
    zone: input.zone,
    labels: input.labels ?? {},
    capacity: input.capacity,
    status: "ready",
    trustState: "verified",
    trustUpdatedAt: now,
    trustExpiresAt: trustExpiryDate(nodeTrustTtlHours()),
    lastSeenAt: now,
  };
}

export function registerNode(nodes: NodeSpec[], input: NodeRegistrationRequest): NodeSpec {
  const node = createRegisteredNode(input);
  mutateState(() => {
    nodes.push(node);
  });
  return node;
}

export function refreshNodeHeartbeat(node: NodeSpec, lastSeenAt = new Date().toISOString()): NodeSpec {
  return {
    ...node,
    lastSeenAt,
    trustState: node.trustState === "expired" || node.trustState === "pending" ? "trusted" : node.trustState,
    trustUpdatedAt: lastSeenAt,
    trustExpiresAt: trustExpiryDate(nodeTrustTtlHours()),
    status: node.status === "offline" ? "pending" : node.status,
  };
}
