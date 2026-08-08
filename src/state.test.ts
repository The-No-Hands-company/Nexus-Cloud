import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd();

function createSeedState(nodeId: string) {
  return {
    nodes: [
      {
        id: nodeId,
        name: nodeId,
        region: "local",
        zone: "local-a",
        labels: {},
        capacity: { cpu: 2, memoryMb: 2048, storageGb: 20 },
        status: "ready",
      },
    ],
    workloads: [],
    peers: [],
    events: [],
    volumes: [],
    units: [],
    healthChecks: [],
    guardianDecisions: [],
  };
}

async function importFreshStateModule(tag: string) {
  return await import(
    `./state.ts?case=${encodeURIComponent(`${tag}-${Date.now()}-${Math.random()}`)}`
  );
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env.NEXUS_CLOUD_STATE_PATH = undefined;
});

describe("platform state durability", () => {
  test("creates a backup snapshot when persisting updates", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-state-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const stateModule = await importFreshStateModule("backup-create");
      stateModule.resetPlatformStateForTests(createSeedState("node-primary"));
      stateModule.mutateState((draft: any) => {
        draft.nodes.push({
          id: "node-secondary",
          name: "node-secondary",
          region: "local",
          zone: "local-b",
          labels: {},
          capacity: { cpu: 1, memoryMb: 1024, storageGb: 10 },
          status: "ready",
        });
      });

      const metadata = stateModule.getPlatformStateMetadata();
      expect(metadata.exists).toBe(true);
      expect(existsSync(`${metadata.path}.bak`)).toBe(true);
      expect(existsSync(`${metadata.path}.tmp`)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recovers from temp file when primary is corrupted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-state-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const stateModule = await importFreshStateModule("recover-temp");
      stateModule.resetPlatformStateForTests(createSeedState("node-initial"));

      const metadata = stateModule.getPlatformStateMetadata();
      const recoveredState = createSeedState("node-from-temp");
      writeFileSync(metadata.path, "{invalid-json");
      writeFileSync(`${metadata.path}.tmp`, `${JSON.stringify(recoveredState, null, 2)}\n`);

      const recovery = stateModule.recoverPlatformStateFromDisk();
      expect(recovery.source).toBe("temp");
      expect(recovery.recovered).toBe(true);
      expect(stateModule.snapshot().nodes[0]?.id).toBe("node-from-temp");

      const persisted = JSON.parse(readFileSync(metadata.path, "utf8"));
      expect(persisted.nodes[0]?.id).toBe("node-from-temp");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recovers from backup when primary and temp are invalid", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-state-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const stateModule = await importFreshStateModule("recover-backup");
      stateModule.resetPlatformStateForTests(createSeedState("node-initial"));

      const metadata = stateModule.getPlatformStateMetadata();
      const backupState = createSeedState("node-from-backup");
      writeFileSync(metadata.path, "{invalid-json");
      writeFileSync(`${metadata.path}.tmp`, "{also-invalid");
      writeFileSync(`${metadata.path}.bak`, `${JSON.stringify(backupState, null, 2)}\n`);

      const recovery = stateModule.recoverPlatformStateFromDisk();
      expect(recovery.source).toBe("backup");
      expect(recovery.recovered).toBe(true);
      expect(stateModule.snapshot().nodes[0]?.id).toBe("node-from-backup");

      const persisted = JSON.parse(readFileSync(metadata.path, "utf8"));
      expect(persisted.nodes[0]?.id).toBe("node-from-backup");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
