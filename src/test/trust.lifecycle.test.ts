import { describe, expect, test } from "bun:test";
import { controlPlaneService } from "../control-plane";
import { federationService } from "../federation";
import { mutateState, resetPlatformStateForTests } from "../state";

function resetState(): void {
  resetPlatformStateForTests({
    nodes: [],
    workloads: [],
    peers: [],
    events: [],
    volumes: [],
    units: [],
    healthChecks: [],
    guardianDecisions: [],
  });
}

describe("trust lifecycle", () => {
  test("node trust transitions to expired when trust TTL elapses", () => {
    resetState();

    const node = controlPlaneService.registerNode({
      name: "node-1",
      region: "eu",
      zone: "eu-a",
      capacity: { cpu: 4, memoryMb: 4096, storageGb: 100 },
      labels: { role: "edge" },
    });

    expect(node.trustState).toBe("verified");
    expect(node.trustExpiresAt).toEqual(expect.any(String));

    const expired = controlPlaneService.applyNodeTrustExpiry(new Date(Date.now() + 1000 * 60 * 60 * 24 * 10));
    expect(expired).toBe(1);

    const after = controlPlaneService.listNodes()[0];
    expect(after?.trustState).toBe("expired");
  });

  test("peer trust transitions from trusted to expired when trust TTL elapses", () => {
    resetState();

    const peer = federationService.trustPeer("peer.example.com", {
      method: "POST",
      path: "/v1/federation/peers/peer.example.com/trust",
      host: "cloud.example.com",
      timestamp: new Date().toISOString(),
      nonce: crypto.randomUUID(),
      keyId: "peer-key-1",
      signature: "signed-by-peer",
    });

    expect(peer.trustState).toBe("trusted");
    expect(peer.trustExpiresAt).toEqual(expect.any(String));

    const expired = federationService.applyPeerTrustExpiry(new Date(Date.now() + 1000 * 60 * 60 * 24 * 10));
    expect(expired).toBe(1);

    const after = federationService.listPeers()[0];
    expect(after?.trustState).toBe("expired");
    expect(after?.status).toBe("degraded");
  });

  test("scheduler ignores trust-blocked nodes during placement", () => {
    resetState();

    const trustedNode = controlPlaneService.registerNode({
      name: "trusted-node",
      region: "eu",
      zone: "eu-a",
      capacity: { cpu: 4, memoryMb: 4096, storageGb: 100 },
      labels: { role: "edge" },
    });
    const blockedNode = controlPlaneService.registerNode({
      name: "blocked-node",
      region: "eu",
      zone: "eu-b",
      capacity: { cpu: 4, memoryMb: 4096, storageGb: 100 },
      labels: { role: "edge" },
    });

    controlPlaneService.promoteNodeTrust(trustedNode.id);
    controlPlaneService.quarantineNodeTrust(blockedNode.id);
    mutateState((draft) => {
      const a = draft.nodes.find((node) => node.id === trustedNode.id);
      const b = draft.nodes.find((node) => node.id === blockedNode.id);
      if (a) a.status = "ready";
      if (b) b.status = "ready";
    });

    const result = controlPlaneService.planWorkload({
      id: "workload-a",
      name: "Workload A",
      image: "nginx:latest",
      replicas: 2,
      cpuMillicores: 100,
      memoryMb: 128,
      env: {},
      ports: [80],
      runtime: "container",
      storage: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.decisions.length).toBe(1);
      expect(result.plan.decisions[0].nodeId).toBe(trustedNode.id);
    }
  });
});