import { describe, expect, test } from "bun:test";
import {
	CATALOG_AUDIENCES,
	CATALOG_SHELVES,
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
		const { keywords: _, ...missingKeywords } = proposal;
		expect(validateCatalogProposal(missingKeywords)).toBeNull();
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
			expect(exploreFallbackCatalog(reviewStatus)).toMatchObject({
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
