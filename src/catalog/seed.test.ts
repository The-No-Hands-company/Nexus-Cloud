import { describe, expect, test } from "bun:test";
import type { ApprovedCatalog } from "../systems-api/catalog";
import {
	CATALOG_SEED_VERSION,
	CORE_CATALOG_SEED,
	type SeedRegistry,
	applyCoreCatalogSeed,
} from "./seed";

function registryWithTools(
	ids: string[],
	existing: Record<string, ApprovedCatalog | null> = {},
): SeedRegistry & {
	records: Record<string, ApprovedCatalog | null>;
	seedVersion: number;
} {
	const records: Record<string, ApprovedCatalog | null> = { ...existing };
	const result = {
		records,
		seedVersion: 0,
		listTools: () => ids.map((id) => ({ id })),
		getCatalogRecord: (toolId: string) =>
			records[toolId] === undefined ? null : { approved: records[toolId] },
		getCatalogSeedVersion: () => result.seedVersion,
		saveApprovedCatalog: (toolId: string, approved: ApprovedCatalog) => {
			records[toolId] = approved;
		},
		setCatalogSeedVersion: (version: number) => {
			result.seedVersion = version;
		},
	} as SeedRegistry & {
		records: Record<string, ApprovedCatalog | null>;
		seedVersion: number;
	};
	return result;
}

describe("core catalog seed", () => {
	test("assigns registered core apps to controlled shelves", () => {
		const registry = registryWithTools([
			"nexus-email",
			"nexus-calendar",
			"unknown",
		]);
		const result = applyCoreCatalogSeed(registry);
		expect(result.applied).toEqual(["nexus-calendar", "nexus-email"]);
		expect(result.skipped).toContain("nexus-chat");
		expect(registry.records["nexus-email"]).toMatchObject({
			primaryShelf: "everyday",
			maturity: "stable",
			version: CATALOG_SEED_VERSION,
		});
		expect(registry.records["nexus-calendar"]?.secondaryShelves).toContain(
			"personal",
		);
	});

	test("does not overwrite newer approvals and is idempotent", () => {
		const chatSeed = CORE_CATALOG_SEED["nexus-chat"];
		if (!chatSeed) throw new Error("Missing chat seed");
		const newer: ApprovedCatalog = {
			...chatSeed,
			visibility: "default",
			surface: "user-app",
			releaseState: "released",
			approvedAt: "2026-10-17T00:00:00.000Z",
			approvedBy: "operator",
			version: 9,
		};
		const registry = registryWithTools(["nexus-chat"], { "nexus-chat": newer });
		expect(applyCoreCatalogSeed(registry)).toMatchObject({
			applied: [],
			skipped: expect.arrayContaining(["nexus-chat"]),
		});
		expect(registry.records["nexus-chat"]?.approvedBy).toBe("operator");
		expect(registry.seedVersion).toBe(CATALOG_SEED_VERSION);
		expect(applyCoreCatalogSeed(registry)).toMatchObject({
			applied: [],
			skipped: expect.arrayContaining(["nexus-chat"]),
		});
	});
});
