import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovedCatalog, CatalogProposal } from "./catalog";

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
        catalog: { proposals: {}, approved: {} },
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
        catalog: { proposals: {}, approved: {} },
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
        catalog: { proposals: {}, approved: {} },
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

describe("catalog registry durability", () => {
  test("loads an old snapshot without catalog as empty catalog maps", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-catalog-old-"));
    try {
      process.chdir(tempDir);
      writeFileSync("registry.json", JSON.stringify({ tools: [], publicUrls: [], addresses: [], history: [], exposures: [], domains: [] }));
      process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = join(tempDir, "registry.json");
      const store = await importFreshStoreModule("catalog-old");
      expect(store.loadSystemsApiRegistry().catalog).toEqual({ proposals: {}, approved: {} });
    } finally {
      delete process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("round trips every proposal and approval field", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-catalog-roundtrip-"));
    try {
      process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = join(tempDir, "registry.json");
      const store = await importFreshStoreModule("catalog-roundtrip");
      const proposal: CatalogProposal = { suggestedShelves: ["develop"], suggestedAudiences: ["developer"], capabilities: ["code"], keywords: ["editor"], submittedAt: "2026-10-17T00:00:00.000Z", version: 2 };
      const approved: ApprovedCatalog = { primaryShelf: "develop", secondaryShelves: ["work"], audiences: ["developer"], capabilities: ["code"], maturity: "stable", visibility: "discoverable", approvedAt: "2026-10-17T01:00:00.000Z", approvedBy: "operator", version: 1 };
      store.saveSystemsApiRegistry({ tools: [], publicUrls: [], addresses: [], history: [], exposures: [], domains: [], catalog: { proposals: { editor: proposal }, approved: { editor: approved } } });
      expect(store.loadSystemsApiRegistry().catalog).toEqual({ proposals: { editor: proposal }, approved: { editor: approved } });
    } finally {
      delete process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("discards malformed catalog records while preserving valid tools and records", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nexus-cloud-catalog-corrupt-"));
    try {
      process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH = join(tempDir, "registry.json");
      const proposal = { suggestedShelves: ["develop"], suggestedAudiences: [], capabilities: [], keywords: [], submittedAt: "2026-10-17T00:00:00.000Z", version: 1 };
      writeFileSync(join(tempDir, "registry.json"), JSON.stringify({ tools: [{ id: "editor", name: "Editor", description: "Code editor" }], catalog: { proposals: { editor: proposal, broken: { ...proposal, version: 0 } }, approved: { editor: { primaryShelf: "invalid" } } } }));
      const store = await importFreshStoreModule("catalog-corrupt");
      const loaded = store.loadSystemsApiRegistry();
      expect(loaded.tools[0]?.id).toBe("editor");
      expect(loaded.catalog).toEqual({ proposals: { editor: proposal }, approved: {} });
    } finally {
      delete process.env.NEXUS_CLOUD_SYSTEMS_API_REGISTRY_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
