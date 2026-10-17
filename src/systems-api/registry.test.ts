import { describe, expect, test } from "bun:test";
import { createSystemsApiTestHarness } from "../test/systems-api-harness";

describe("catalog registry service", () => {
  test("saves a proposal and approval independently and persists both", async () => {
    const harness = await createSystemsApiTestHarness();
    try {
      const proposal = { suggestedShelves: ["develop"], suggestedAudiences: ["developer"], capabilities: ["code"], keywords: ["editor"], submittedAt: "2026-10-17T00:00:00.000Z", version: 2 } as const;
      const approved = { primaryShelf: "develop", secondaryShelves: ["work"], audiences: ["developer"], capabilities: ["code"], maturity: "stable", visibility: "discoverable", approvedAt: "2026-10-17T01:00:00.000Z", approvedBy: "operator", version: 1 } as const;
      harness.systemsApiService.saveCatalogProposal("editor", { ...proposal, suggestedShelves: [...proposal.suggestedShelves], suggestedAudiences: [...proposal.suggestedAudiences], capabilities: [...proposal.capabilities], keywords: [...proposal.keywords] });
      harness.systemsApiService.saveApprovedCatalog("editor", { ...approved, secondaryShelves: [...approved.secondaryShelves], audiences: [...approved.audiences], capabilities: [...approved.capabilities] });
      expect(harness.systemsApiService.getCatalogRecord("editor")).toEqual({ toolId: "editor", proposal, approved, reviewStatus: "pending" });
      const registry = await Bun.file(harness.systemsApiService.describeSystemsApiStatus().registry.path).json();
      expect(registry.catalog).toEqual({ proposals: { editor: proposal }, approved: { editor: approved } });
    } finally {
      harness.cleanup();
    }
  });
});
