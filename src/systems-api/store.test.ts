import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd();

async function importFreshStoreModule(tag: string) {
  return await import(
    `./store.ts?case=${encodeURIComponent(`${tag}-${Date.now()}-${Math.random()}`)}`
  );
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

describe("requiresAuth durability", () => {
  // Found in production: restarting Cloud silently un-gated chat.tnhc.dev.
  // The flag lived only in memory, because the deserializer builds each tool
  // field by field and this one was never read. A reload dropped it and the
  // next heartbeat wrote the stripped record back over the good one. It failed
  // open, and nothing anywhere reported a change — the worst way for a
  // security switch to behave.
  test("survives a write-then-read of the registry", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-requiresauth-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const storeModule = await importFreshStoreModule("requires-auth");
      const now = new Date().toISOString();
      storeModule.saveSystemsApiRegistry({
        tools: [
          {
            id: "tool-gated",
            name: "Gated",
            description: "Behind the login gate",
            mode: "standalone",
            exposed: false,
            exposure: "private",
            health: "healthy",
            registrationStatus: "registered",
            capabilities: [],
            heartbeatCount: 0,
            registeredAt: now,
            updatedAt: now,
            upstreamUrl: "http://127.0.0.1:4200",
            requiresAuth: true,
          },
        ],
        publicUrls: [],
        addresses: [],
        history: [],
        exposures: [],
        domains: [],
      });

      const reloaded = storeModule.loadSystemsApiRegistry();
      expect(reloaded.tools[0]?.requiresAuth).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("an ungated tool stays ungated, rather than becoming undefined", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-requiresauth-off-"));
    try {
      mkdirSync(join(tempDir, "data"), { recursive: true });
      process.chdir(tempDir);

      const storeModule = await importFreshStoreModule("requires-auth-off");
      const now = new Date().toISOString();
      storeModule.saveSystemsApiRegistry({
        tools: [
          {
            id: "tool-open",
            name: "Open",
            description: "Public",
            mode: "standalone",
            exposed: true,
            exposure: "public",
            health: "healthy",
            registrationStatus: "registered",
            capabilities: [],
            heartbeatCount: 0,
            registeredAt: now,
            updatedAt: now,
            requiresAuth: false,
          },
        ],
        publicUrls: [],
        addresses: [],
        history: [],
        exposures: [],
        domains: [],
      });

      expect(storeModule.loadSystemsApiRegistry().tools[0]?.requiresAuth).toBe(false);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
