import { describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness, emptySystemsApiRegistry } from "./systems-api-harness";

describe("Systems API registry/service behavior", () => {
  test("request and revoke exposure update registry state and history", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-gamma",
        name: "Gamma",
        description: "Gamma tool",
        exposed: false,
        health: "healthy",
        capabilities: ["exposure.lifecycle"],
      });

      const requested = systemsApiService.requestSystemsApiExposure({
        toolId: "tool-gamma",
        desiredHost: "gamma.example.com",
      });
      expect(requested?.status).toBe("active");
      expect(systemsApiService.getSystemsApiExposure("tool-gamma")?.status).toBe("active");

      const revoked = systemsApiService.revokeSystemsApiExposure("tool-gamma");
      expect(revoked?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiExposure("tool-gamma")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiTools()[0]?.exposed).toBe(false);
      expect(systemsApiService.listSystemsApiToolHistory("tool-gamma").map((entry: { action: string }) => entry.action)).toEqual(
        expect.arrayContaining(["registered", "exposure-requested", "exposure-activated", "exposure-revoked"]),
      );
    } finally {
      harness.cleanup();
    }
  });

  test("rejects domain binding before public URL issuance, accepts it after, and revokes dependent records", async () => {
    const harness = await createSystemsApiTestHarness(emptySystemsApiRegistry);
    try {
      const { systemsApiService } = harness;

      systemsApiService.registerSystemsApiTool({
        id: "tool-delta",
        name: "Delta",
        description: "Delta tool",
        exposed: false,
        health: "healthy",
        capabilities: ["domains.binding"],
      });

      expect(
        systemsApiService.requestSystemsApiDomainBinding({
          toolId: "tool-delta",
          domain: "delta.example.com",
        }),
      ).toBeNull();

      const publicUrl = systemsApiService.issueSystemsApiPublicUrl({
        toolId: "tool-delta",
        desiredHost: "public.delta.example.com",
      });
      expect(publicUrl).not.toBeNull();
      expect(publicUrl?.status).toBe("active");

      const binding = systemsApiService.requestSystemsApiDomainBinding({
        toolId: "tool-delta",
        domain: "delta.example.com",
      });
      expect(binding).not.toBeNull();
      expect(binding?.status).toBe("pending");
      expect(binding?.canonicalUrl).toBe("https://tool-delta.nexus.local");
      expect(binding?.publicUrl).toBe("https://public.delta.example.com");

      const bindingAfterPublicUrl = systemsApiService.getSystemsApiDomainBinding("delta.example.com");
      expect(bindingAfterPublicUrl?.publicUrl).toBe("https://public.delta.example.com");
      expect(bindingAfterPublicUrl?.status).toBe("pending");

      const revokedExposure = systemsApiService.revokeSystemsApiExposure("tool-delta");
      expect(revokedExposure?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiExposure("tool-delta")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiPublicUrls()[0]?.status).toBe("revoked");
      expect(systemsApiService.getSystemsApiDomainBinding("delta.example.com")?.status).toBe("revoked");
      expect(systemsApiService.listSystemsApiTools()[0]?.exposed).toBe(false);
      expect(systemsApiService.listSystemsApiToolHistory("tool-delta").map((entry: { action: string }) => entry.action)).toEqual(
        expect.arrayContaining(["registered", "public-url-issued", "exposure-requested", "exposure-activated", "domain-bound", "exposure-revoked", "domain-revoked"]),
      );
    } finally {
      harness.cleanup();
    }
  });
});
