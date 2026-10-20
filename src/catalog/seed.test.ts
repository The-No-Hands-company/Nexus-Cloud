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
			surface: "user-app",
			releaseState: "released",
			version: CATALOG_SEED_VERSION,
		});
		expect(registry.records["nexus-calendar"]).toMatchObject({
			surface: "user-app",
			releaseState: "staged",
		});
		expect(registry.records["nexus-calendar"]?.secondaryShelves).toContain(
			"personal",
		);
	});

	test("classifies every first-wave tool and stages unreleased user apps", () => {
		const ids = Object.keys(CORE_CATALOG_SEED);
		const registry = registryWithTools(ids);
		expect(applyCoreCatalogSeed(registry).applied).toHaveLength(ids.length);
		for (const id of ["nexus-auth", "nexus-network", "nexus-vault"])
			expect(registry.records[id]).toMatchObject({ surface: "platform-service", releaseState: "released" });
		expect(registry.records["nexus-cloud"]).toMatchObject({ surface: "admin-console", releaseState: "released" });
		for (const id of ["nexus-terminal", "nexus-forge"])
			expect(registry.records[id]).toMatchObject({ surface: "developer-tool", releaseState: "released" });
		for (const id of ["nexus-email", "nexus-hosting"])
			expect(registry.records[id]).toMatchObject({ surface: "user-app", releaseState: "released" });
		for (const id of ["nexus-calendar", "nexus-chat", "nexus-project", "nexus-design", "nexus-graphic", "nexus-photos", "nexus-video", "nexus-draw", "nexus-deploy"])
			expect(registry.records[id]).toMatchObject({ surface: "user-app", releaseState: "staged" });
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
