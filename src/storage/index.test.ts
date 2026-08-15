import { afterEach, describe, expect, test } from "bun:test";
import {
  storageConfigForPool,
  type SharedStoragePool,
} from ".";

const originalEnvironment = {
  accessKey: process.env.NEXUS_STORAGE_S3_ACCESS_KEY,
  secretKey: process.env.NEXUS_STORAGE_S3_SECRET_KEY,
};

afterEach(() => {
  if (originalEnvironment.accessKey === undefined) delete process.env.NEXUS_STORAGE_S3_ACCESS_KEY;
  else process.env.NEXUS_STORAGE_S3_ACCESS_KEY = originalEnvironment.accessKey;
  if (originalEnvironment.secretKey === undefined) delete process.env.NEXUS_STORAGE_S3_SECRET_KEY;
  else process.env.NEXUS_STORAGE_S3_SECRET_KEY = originalEnvironment.secretKey;
});

describe("shared storage pool credentials", () => {
  test("uses current protected configuration instead of legacy persisted credentials", () => {
    process.env.NEXUS_STORAGE_S3_ACCESS_KEY = "CURRENT_ACCESS_SENTINEL";
    process.env.NEXUS_STORAGE_S3_SECRET_KEY = "CURRENT_SECRET_SENTINEL";
    const legacyPool: SharedStoragePool = {
      id: "local-pool",
      name: "Local pool",
      ownerNodeId: "node-1",
      ownerNodeDid: "did:nexus:node-1",
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKey: "STALE_ACCESS_SENTINEL",
      secretKey: "STALE_SECRET_SENTINEL",
      totalCapacityGb: 100,
      availableCapacityGb: 100,
      status: "active",
      tags: [],
      replicationFactor: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };

    const config = storageConfigForPool(legacyPool);

    expect(config.accessKey).toBe("CURRENT_ACCESS_SENTINEL");
    expect(config.secretKey).toBe("CURRENT_SECRET_SENTINEL");
    expect(JSON.stringify(config)).not.toContain("STALE_");
  });
});
