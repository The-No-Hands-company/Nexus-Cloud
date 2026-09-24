import { describe, expect, test } from "bun:test";
import type { ControlPlaneSnapshot } from "./control-plane/service";
import { startupSummary } from "./startup-summary";

describe("startupSummary", () => {
  test("does not serialize storage credentials, endpoints, or nested metadata", () => {
    const snapshot: ControlPlaneSnapshot = {
      nodes: [],
      workloads: [],
      peers: [],
      events: [
        {
          kind: "audit",
          subjectId: "node-1",
          message: "storage pool registered",
          timestamp: "2026-08-14T00:00:00.000Z",
          metadata: { token: "TOKEN_SENTINEL" },
        },
      ],
      volumes: [],
      sharedStoragePools: [
        {
          id: "pool-1",
          name: "private-pool",
          ownerNodeId: "node-1",
          ownerNodeDid: "did:nexus:node-1",
          endpoint: "http://private:9000",
          region: "eu-north-1",
          accessKey: "ACCESS_SENTINEL",
          secretKey: "SECRET_SENTINEL", // pragma: allowlist secret — test sentinel
          totalCapacityGb: 100,
          availableCapacityGb: 75,
          status: "active",
          tags: [],
          replicationFactor: 1,
          createdAt: "2026-08-14T00:00:00.000Z",
          updatedAt: "2026-08-14T00:00:00.000Z",
        },
      ],
      units: [],
      healthChecks: [],
      guardianDecisions: [],
    };

    const summary = startupSummary(snapshot);
    const encoded = JSON.stringify(summary);

    for (const secret of [
      "ACCESS_SENTINEL",
      "SECRET_SENTINEL",
      "TOKEN_SENTINEL",
      "http://private:9000",
    ]) {
      expect(encoded).not.toContain(secret);
    }
    expect(summary).toMatchObject({ storagePoolCount: 1 });
  });
});
