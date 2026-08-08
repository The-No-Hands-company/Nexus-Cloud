import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservabilityEvent } from "../observability";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    kind: "audit",
    subjectId: "tool-x:exposure",
    message: "test event",
    timestamp: new Date().toISOString(),
    level: "info",
    source: "registry",
    ...overrides,
  };
}

// ── Unit: appendAuditEntry / queryAuditLog ────────────────────────────────────

describe("audit log — NDJSON persistence", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "nexus-audit-test-"));
    mkdirSync(join(tempDir, "data"), { recursive: true });
    process.chdir(tempDir);
    // reset module cache so resolveAuditLogPath picks up the new cwd
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("appendAuditEntry writes a parseable NDJSON line", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    const event = makeEvent({ subjectId: "tool-a:exposure", message: "registered" });
    appendAuditEntry(event);
    const entries = queryAuditLog();
    expect(entries.length).toBe(1);
    expect(entries[0]?.subjectId).toBe("tool-a:exposure");
    expect(entries[0]?.message).toBe("registered");
  });

  test("queryAuditLog returns all entries when no filter is provided", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(makeEvent({ subjectId: "a", timestamp: "2025-01-01T00:00:00.000Z" }));
    appendAuditEntry(makeEvent({ subjectId: "b", timestamp: "2025-01-02T00:00:00.000Z" }));
    appendAuditEntry(makeEvent({ subjectId: "c", timestamp: "2025-01-03T00:00:00.000Z" }));
    const entries = queryAuditLog();
    expect(entries.length).toBe(3);
  });

  test("queryAuditLog returns entries newest-first", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(makeEvent({ subjectId: "old", timestamp: "2025-01-01T00:00:00.000Z" }));
    appendAuditEntry(makeEvent({ subjectId: "new", timestamp: "2025-06-01T00:00:00.000Z" }));
    const entries = queryAuditLog();
    expect(entries[0]?.subjectId).toBe("new");
    expect(entries[1]?.subjectId).toBe("old");
  });

  test("queryAuditLog filters by subjectId", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(makeEvent({ subjectId: "tool-x:exposure" }));
    appendAuditEntry(makeEvent({ subjectId: "tool-y:exposure" }));
    const entries = queryAuditLog({ subjectId: "tool-x:exposure" });
    expect(entries.length).toBe(1);
    expect(entries[0]?.subjectId).toBe("tool-x:exposure");
  });

  test("queryAuditLog filters by level", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(makeEvent({ level: "info" }));
    appendAuditEntry(makeEvent({ level: "error" }));
    const entries = queryAuditLog({ level: "error" });
    expect(entries.length).toBe(1);
    expect(entries[0]?.level).toBe("error");
  });

  test("queryAuditLog filters by time range (from / to)", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(makeEvent({ subjectId: "early", timestamp: "2025-01-01T00:00:00.000Z" }));
    appendAuditEntry(makeEvent({ subjectId: "mid", timestamp: "2025-03-01T00:00:00.000Z" }));
    appendAuditEntry(makeEvent({ subjectId: "late", timestamp: "2025-06-01T00:00:00.000Z" }));

    const entries = queryAuditLog({
      from: "2025-02-01T00:00:00.000Z",
      to: "2025-04-01T00:00:00.000Z",
    });
    expect(entries.length).toBe(1);
    expect(entries[0]?.subjectId).toBe("mid");
  });

  test("queryAuditLog filters by metadata fields (eventType/action/actor)", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    appendAuditEntry(
      makeEvent({
        subjectId: "node-a",
        metadata: { eventType: "node-trust-action", action: "quarantine", actor: "ops@example" },
      }),
    );
    appendAuditEntry(
      makeEvent({
        subjectId: "node-b",
        metadata: { eventType: "node-trust-action", action: "promote", actor: "ops@example" },
      }),
    );

    const entries = queryAuditLog({
      eventType: "node-trust-action",
      action: "quarantine",
      actor: "ops@example",
    });
    expect(entries.length).toBe(1);
    expect(entries[0]?.subjectId).toBe("node-a");
  });

  test("queryAuditLog respects limit parameter", async () => {
    const { appendAuditEntry, queryAuditLog } = await import("./index");
    for (let i = 0; i < 10; i++) {
      appendAuditEntry(makeEvent({ subjectId: `tool-${i}` }));
    }
    const entries = queryAuditLog({ limit: 3 });
    expect(entries.length).toBe(3);
  });

  test("queryAuditLog returns [] when log file does not exist", async () => {
    const { queryAuditLog } = await import("./index");
    const entries = queryAuditLog();
    expect(entries).toEqual([]);
  });

  test("appendAuditEntry never throws even if parent dir is missing", async () => {
    const { appendAuditEntry } = await import("./index");
    // Point to a deeply nested path that doesn't exist
    process.env.NEXUS_CLOUD_AUDIT_PATH = join(tempDir, "nonexistent", "deep", "audit.ndjson");
    expect(() => appendAuditEntry(makeEvent())).not.toThrow();
    process.env.NEXUS_CLOUD_AUDIT_PATH = undefined;
  });
});

// ── Integration: API endpoints for audit log ──────────────────────────────────

describe("audit API endpoints", () => {
  let handleRequest: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(async () => {
    const { createSystemsApiTestHarness } = await import("../test/systems-api-harness");
    const harness = await createSystemsApiTestHarness();
    handleRequest = harness.handleRequest;
    cleanup = harness.cleanup;
  });

  afterEach(() => cleanup?.());

  test("GET /api/v1/audit returns { events, count } with 200", async () => {
    const res = await handleRequest(
      new Request("http://localhost/api/v1/audit", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[]; count: number };
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(body.events.length);
  });

  test("GET /api/v1/audit/:subjectId returns filtered results", async () => {
    // Seed an audit event via the observability service
    const { observabilityService } = await import("../observability");
    observabilityService.recordEvent(
      makeEvent({ subjectId: "tool-abc:exposure", message: "approved" }),
    );

    const res = await handleRequest(
      new Request("http://localhost/api/v1/audit/tool-abc%3Aexposure", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ObservabilityEvent[]; count: number };
    expect(body.events.every((e) => e.subjectId === "tool-abc:exposure")).toBe(true);
  });

  test("GET /api/v1/audit?subjectId= filters via query param", async () => {
    const { observabilityService } = await import("../observability");
    observabilityService.recordEvent(makeEvent({ subjectId: "qp-subject:exposure" }));
    observabilityService.recordEvent(makeEvent({ subjectId: "other:exposure" }));

    const res = await handleRequest(
      new Request("http://localhost/api/v1/audit?subjectId=qp-subject%3Aexposure", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ObservabilityEvent[]; count: number };
    expect(body.events.every((e) => e.subjectId === "qp-subject:exposure")).toBe(true);
  });

  test("GET /api/v1/audit supports trust timeline filters", async () => {
    const { observabilityService } = await import("../observability");
    observabilityService.recordEvent(
      makeEvent({
        subjectId: "node-filter-a",
        metadata: { eventType: "node-trust-action", action: "quarantine", actor: "ops@example" },
      }),
    );
    observabilityService.recordEvent(
      makeEvent({
        subjectId: "node-filter-b",
        metadata: { eventType: "node-trust-action", action: "promote", actor: "ops@example" },
      }),
    );

    const res = await handleRequest(
      new Request(
        "http://localhost/api/v1/audit?eventType=node-trust-action&action=quarantine&actor=ops%40example",
        { method: "GET" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ObservabilityEvent[]; count: number };
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(
      body.events.every(
        (e) =>
          e.metadata?.eventType === "node-trust-action" &&
          e.metadata?.action === "quarantine" &&
          e.metadata?.actor === "ops@example",
      ),
    ).toBe(true);
  });
});

// ── Integration: guardian enforcement in listActiveRoutes ─────────────────────

describe("listActiveRoutes — guardian enforcement", () => {
  let systemsApiService: typeof import("../systems-api").systemsApiService;
  let guardianService: typeof import("../guardian").guardianService;
  let cleanup: () => void;

  beforeEach(async () => {
    const { createSystemsApiTestHarness } = await import("../test/systems-api-harness");
    const harness = await createSystemsApiTestHarness();
    cleanup = harness.cleanup;

    const mod = await import("../systems-api");
    systemsApiService = mod.systemsApiService;
    const gMod = await import("../guardian");
    guardianService = gMod.guardianService;
  });

  afterEach(() => cleanup?.());

  function registerAndExpose(toolId: string, domain: string) {
    systemsApiService.registerSystemsApiTool({
      id: toolId,
      name: toolId,
      description: "",
      upstreamUrl: "http://127.0.0.1:9000",
      exposed: false,
      health: "healthy",
      capabilities: [],
    });
    systemsApiService.requestSystemsApiExposure({ toolId, desiredHost: domain });
  }

  test("approved tool appears in listActiveRoutes", async () => {
    registerAndExpose("t-approved", "approved.example.com");
    // requestSystemsApiExposure seeds a decision via evaluateGuardianRequest; a healthy tool → approved
    const { listSystemsApiRoutes } = await import("../systems-api");
    const routes = listSystemsApiRoutes();
    const domains = routes.map((r) => r.domain);
    expect(domains).toContain("approved.example.com");
  });

  test("denied tool is excluded from listActiveRoutes", async () => {
    registerAndExpose("t-denied", "denied.example.com");
    guardianService.denyGuardianDecision("exposure", "t-denied:exposure");

    const { listSystemsApiRoutes } = await import("../systems-api");
    const routes = listSystemsApiRoutes();
    const domains = routes.map((r) => r.domain);
    expect(domains).not.toContain("denied.example.com");
  });

  test("suspended tool is excluded from listActiveRoutes", async () => {
    registerAndExpose("t-suspended", "suspended.example.com");
    guardianService.suspendGuardianDecision("exposure", "t-suspended:exposure");

    const { listSystemsApiRoutes } = await import("../systems-api");
    const routes = listSystemsApiRoutes();
    const domains = routes.map((r) => r.domain);
    expect(domains).not.toContain("suspended.example.com");
  });

  test("quarantined tool is excluded from listActiveRoutes", async () => {
    registerAndExpose("t-quarantined", "quarantined.example.com");
    guardianService.quarantineGuardianDecision("exposure", "t-quarantined:exposure");

    const { listSystemsApiRoutes } = await import("../systems-api");
    const routes = listSystemsApiRoutes();
    const domains = routes.map((r) => r.domain);
    expect(domains).not.toContain("quarantined.example.com");
  });

  test("phantom-compliant tools are tagged as phantom-hardened routes", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "t-hardened",
      name: "t-hardened",
      description: "",
      upstreamUrl: "http://127.0.0.1:9000",
      exposed: false,
      health: "healthy",
      capabilities: [],
      phantomSecurityProfile: {
        claimedSecured: true,
        protectionLevel: "hardened",
        guarantees: {
          postQuantum: true,
          fheTransport: true,
          zkProofs: true,
        },
        metadata: {
          pqAlgorithms: ["kyber-1024"],
          fheScheme: "ckks",
          zkProofSystem: "plonk",
          proofAttestation: "attested-by-cloud",
          proofEndpoint: "https://t-hardened.nexus.local/proofs",
        },
      },
    });
    systemsApiService.requestSystemsApiExposure({
      toolId: "t-hardened",
      desiredHost: "hardened.example.com",
    });

    const { listSystemsApiRoutes } = await import("../systems-api");
    const hardenedRoute = listSystemsApiRoutes().find(
      (route) => route.domain === "hardened.example.com",
    );
    expect(hardenedRoute).toBeDefined();
    expect(hardenedRoute?.securityTag).toBe("phantom-hardened");
    expect(hardenedRoute?.phantomProtectionLevel).toBe("hardened");
  });

  test("phantom-claimed tools with incomplete metadata stay transitional", async () => {
    systemsApiService.registerSystemsApiTool({
      id: "t-transitional",
      name: "t-transitional",
      description: "",
      upstreamUrl: "http://127.0.0.1:9000",
      exposed: false,
      health: "healthy",
      capabilities: [],
      phantomSecurityProfile: {
        claimedSecured: true,
        protectionLevel: "maximum",
        guarantees: {
          postQuantum: true,
          fheTransport: true,
          zkProofs: true,
        },
        metadata: {
          pqAlgorithms: ["kyber-1024"],
          fheScheme: "ckks",
        },
      },
    });
    systemsApiService.requestSystemsApiExposure({
      toolId: "t-transitional",
      desiredHost: "transitional.example.com",
    });

    const { listSystemsApiRoutes } = await import("../systems-api");
    const transitionalRoute = listSystemsApiRoutes().find(
      (route) => route.domain === "transitional.example.com",
    );
    expect(transitionalRoute).toBeDefined();
    expect(transitionalRoute?.securityTag).toBe("transitional");
    expect(transitionalRoute?.phantomProtectionLevel).toBe("maximum");
  });
});
