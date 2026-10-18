import { describe, expect, test } from "bun:test";
import type { ApprovedCatalog } from "../systems-api/catalog";
import { resolveEffectiveCatalog, type GlobalCatalogEntry } from "./resolution";

const approved = (toolId: string, primaryShelf: ApprovedCatalog["primaryShelf"] = "everyday"): GlobalCatalogEntry => ({
	toolId,
	name: toolId,
	description: toolId,
	reviewStatus: "approved",
	approved: {
		primaryShelf,
		secondaryShelves: [],
		audiences: ["general"],
		capabilities: ["test"],
		maturity: "stable",
		visibility: "default",
		approvedAt: "2026-10-17T00:00:00.000Z",
		approvedBy: "platform:catalog",
		version: 1,
	},
});

describe("resolveEffectiveCatalog", () => {
	test("tenant disablement cannot be undone by a node or user preference", () => {
		const [entry] = resolveEffectiveCatalog([approved("nexus-mail")], {
			tenantEntitlements: { disabledAppIds: ["nexus-mail"] },
			nodeOverlay: { shelfOverrides: { "nexus-mail": "everyday" } },
			userPreferences: { pinnedIds: ["nexus-mail"], preferredShelf: "everyday" },
			runtime: { "nexus-mail": { health: "healthy", canLaunch: true } },
		});
		expect(entry).toMatchObject({ availability: "disabled", canLaunch: false, preferredByUser: true });
	});

	test("node-local apps stay node-scoped and default to Explore", () => {
		const [entry] = resolveEffectiveCatalog([], {
			nodeOverlay: { localApps: [{ toolId: "local-tool", name: "Local tool", canLaunch: true }] },
			runtime: { "local-tool": { health: "healthy", canLaunch: true } },
		});
		expect(entry).toMatchObject({ toolId: "local-tool", scope: "node", primaryShelf: "explore", reviewStatus: "pending", canLaunch: true });
	});

	test("offline runtime state always prevents launch", () => {
		const [entry] = resolveEffectiveCatalog([approved("nexus-draw", "create")], {
			runtime: { "nexus-draw": { health: "offline", canLaunch: true } },
		});
		expect(entry).toMatchObject({ availability: "offline", canLaunch: false });
	});

	test("preferred shelf and pins affect presentation only", () => {
		const entries = resolveEffectiveCatalog([approved("nexus-mail"), approved("nexus-vault", "operate")], {
			userPreferences: { pinnedIds: ["nexus-vault"], preferredShelf: "operate" },
			runtime: { "nexus-mail": { health: "healthy", canLaunch: false }, "nexus-vault": { health: "healthy", canLaunch: false } },
		});
		expect(entries[0]?.toolId).toBe("nexus-vault");
		expect(entries[0]).toMatchObject({ primaryShelf: "operate", canLaunch: false, preferredByUser: true });
	});
});
