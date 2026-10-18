import { describe, expect, test } from "bun:test";
import {
	CATALOG_AUDIENCES,
	CATALOG_RELEASE_STATES,
	CATALOG_SHELVES,
	CATALOG_SURFACES,
	exploreFallbackCatalog,
	validateApprovedCatalog,
	validateCatalogProposal,
} from "./catalog";

const proposal = {
	suggestedShelves: ["everyday"],
	suggestedAudiences: ["general"],
	capabilities: ["messaging"],
	keywords: ["chat"],
	submittedAt: "2026-10-17T00:00:00.000Z",
	version: 1,
};

const approved = {
	primaryShelf: "everyday",
	secondaryShelves: ["work"],
	audiences: ["general"],
	capabilities: ["messaging"],
	maturity: "stable",
	visibility: "default",
	surface: "user-app",
	releaseState: "released",
	approvedAt: "2026-10-17T00:00:00.000Z",
	approvedBy: "platform-steward",
	version: 2,
};

describe("catalog proposal validation", () => {
	test("accepts every controlled shelf and audience and preserves the version", () => {
		expect(CATALOG_SHELVES).toEqual([
			"everyday",
			"work",
			"create",
			"develop",
			"operate",
			"personal",
			"explore",
		]);
		expect(CATALOG_AUDIENCES).toEqual([
			"general",
			"business",
			"creator",
			"developer",
			"operations",
			"power-user",
		]);
		expect(
			validateCatalogProposal({
				...proposal,
				suggestedShelves: [...CATALOG_SHELVES],
				suggestedAudiences: [...CATALOG_AUDIENCES],
				version: 7,
			}),
		).toEqual({
			...proposal,
			suggestedShelves: [...CATALOG_SHELVES],
			suggestedAudiences: [...CATALOG_AUDIENCES],
			version: 7,
		});
	});

	test("rejects missing fields, empty shelves, unknown values, and duplicates", () => {
		for (const change of [
			{ suggestedShelves: [] },
			{ suggestedShelves: ["unknown"] },
			{ suggestedShelves: ["everyday", "everyday"] },
			{ suggestedAudiences: ["unknown"] },
			{ suggestedAudiences: ["general", "general"] },
			{ capabilities: [" "] },
			{ keywords: [""] },
			{ submittedAt: "yesterday" },
			{ submittedAt: "2026-02-30T00:00:00.000Z" },
			{ version: Number.NaN },
			{ version: Number.POSITIVE_INFINITY },
		]) {
			expect(validateCatalogProposal({ ...proposal, ...change })).toBeNull();
		}
	});

	test("rejects each missing required proposal field", () => {
		for (const field of [
			"suggestedShelves",
			"suggestedAudiences",
			"capabilities",
			"keywords",
			"submittedAt",
			"version",
		] as const) {
			const missing: Partial<typeof proposal> = { ...proposal };
			delete missing[field];
			expect(validateCatalogProposal(missing)).toBeNull();
		}
	});

	test("trims non-empty capabilities and keywords", () => {
		expect(
			validateCatalogProposal({
				...proposal,
				capabilities: [" messaging "],
				keywords: [" chat "],
			}),
		).toMatchObject({
			capabilities: ["messaging"],
			keywords: ["chat"],
		});
	});
});

describe("approved catalog validation", () => {
	const validApprovedCatalog = {
		primaryShelf: "everyday" as const,
		secondaryShelves: [],
		audiences: ["general" as const],
		capabilities: ["mail"],
		maturity: "stable" as const,
		visibility: "default" as const,
		surface: "user-app" as const,
		releaseState: "released" as const,
		approvedAt: "2026-10-18T00:00:00.000Z",
		approvedBy: "platform",
		version: 1,
	};

	test("accepts an explicit user-app release", () => {
		expect(validateApprovedCatalog(validApprovedCatalog)).toMatchObject({
			surface: "user-app",
			releaseState: "released",
		});
	});

	test("defines the controlled surfaces and release states", () => {
		expect(CATALOG_SURFACES).toEqual([
			"user-app",
			"developer-tool",
			"admin-console",
			"platform-service",
		]);
		expect(CATALOG_RELEASE_STATES).toEqual([
			"staged",
			"released",
			"retired",
		]);
	});

	test.each([
		["unknown surface", { surface: "unknown" }],
		["unknown release state", { releaseState: "unknown" }],
		["malformed surface", { surface: null }],
		["malformed release state", { releaseState: 1 }],
	])("rejects invalid release metadata: %s", (_case, change) => {
		expect(validateApprovedCatalog({ ...validApprovedCatalog, ...change })).toBeNull();
	});

	test.each(["surface", "releaseState"] as const)(
		"rejects missing %s",
		(field) => {
			const missing: Partial<typeof validApprovedCatalog> = { ...validApprovedCatalog };
			delete missing[field];
			expect(validateApprovedCatalog(missing)).toBeNull();
		},
	);

	test("rejects missing surface and release state together", () => {
		const missing: Partial<typeof validApprovedCatalog> = { ...validApprovedCatalog };
		delete missing.surface;
		delete missing.releaseState;
		expect(validateApprovedCatalog(missing)).toBeNull();
	});

	test("accepts every controlled primary shelf, audience, maturity, and visibility", () => {
		for (const primaryShelf of CATALOG_SHELVES) {
			for (const maturity of ["stable", "preview", "experimental"]) {
				for (const visibility of [
					"default",
					"discoverable",
					"restricted",
					"hidden",
				]) {
					expect(
						validateApprovedCatalog({
							...approved,
							primaryShelf,
							secondaryShelves: [],
							maturity,
							visibility,
						}),
					).toMatchObject({ primaryShelf, maturity, visibility });
				}
			}
		}
		expect(
			validateApprovedCatalog({
				...approved,
				audiences: [...CATALOG_AUDIENCES],
			})?.audiences,
		).toEqual([...CATALOG_AUDIENCES]);
	});

	test("rejects duplicate or repeated secondary shelves and malformed values", () => {
		for (const change of [
			{ secondaryShelves: ["work", "work"] },
			{ secondaryShelves: ["everyday"] },
			{ secondaryShelves: ["unknown"] },
			{ primaryShelf: "unknown" },
			{ audiences: ["general", "general"] },
			{ maturity: "beta" },
			{ visibility: "public" },
			{ approvedAt: "not-a-date" },
			{ approvedBy: " " },
			{ version: Number.POSITIVE_INFINITY },
		]) {
			expect(validateApprovedCatalog({ ...approved, ...change })).toBeNull();
		}
	});

	test("returns a discoverable Explore placement for unapproved records", () => {
		for (const reviewStatus of ["pending", "deferred", "rejected"] as const) {
			expect(exploreFallbackCatalog(reviewStatus)).toEqual({
				primaryShelf: "explore",
				secondaryShelves: [],
				audiences: [],
				capabilities: [],
				maturity: "experimental",
				visibility: "discoverable",
				reviewStatus,
			});
		}
	});
});
