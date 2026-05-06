import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd();

async function importFreshStoreModule(tag: string) {
  return await import(`./store.ts?case=${encodeURIComponent(`${tag}-${Date.now()}-${Math.random()}`)}`);
}

describe("systems api registry durability", () => {
  test("recovers the registry from a temp snapshot when the primary file is corrupted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-registry-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const storeModule = await importFreshStoreModule("recover-temp");
      storeModule.saveSystemsApiRegistry({
        tools: [],
        publicUrls: [],
        addresses: [],
        history: [],
        exposures: [],
        domains: [],
      });

      const registryPath = storeModule.getSystemsApiRegistryPath();
      const recoveredRegistry = {
        tools: [
          {
            id: "tool-recovered",
            name: "Recovered",
            description: "Recovered registry entry",
            mode: "standalone",
            exposed: false,
            exposure: "private",
            health: "healthy",
            registrationStatus: "active",
            capabilities: [],
            heartbeatCount: 2,
            lastHeartbeatAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        publicUrls: [],
        addresses: [],
        history: [],
        exposures: [],
        domains: [],
      };

      writeFileSync(registryPath, "{invalid-json");
      writeFileSync(`${registryPath}.tmp`, `${JSON.stringify(recoveredRegistry, null, 2)}\n`);

      const recovered = storeModule.recoverSystemsApiRegistryFromDisk();
      expect(recovered.recovery.source).toBe("temp");
      expect(recovered.registry.tools[0]?.id).toBe("tool-recovered");

      const repaired = JSON.parse(readFileSync(registryPath, "utf8"));
      expect(repaired.tools[0]?.id).toBe("tool-recovered");
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});