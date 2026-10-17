/** Curated catalog placement and search metadata. It never grants launch access. */
export const CATALOG_SHELVES = [
	"everyday",
	"work",
	"create",
	"develop",
	"operate",
	"personal",
	"explore",
] as const;
export type CatalogShelf = (typeof CATALOG_SHELVES)[number];

export const CATALOG_AUDIENCES = [
	"general",
	"business",
	"creator",
	"developer",
	"operations",
	"power-user",
] as const;
export type CatalogAudience = (typeof CATALOG_AUDIENCES)[number];

export const CATALOG_MATURITY = ["stable", "preview", "experimental"] as const;
export type CatalogMaturity = (typeof CATALOG_MATURITY)[number];

export const CATALOG_VISIBILITY = [
	"default",
	"discoverable",
	"restricted",
	"hidden",
] as const;
export type CatalogVisibility = (typeof CATALOG_VISIBILITY)[number];

export const CATALOG_REVIEW_STATUSES = [
	"approved",
	"pending",
	"deferred",
	"rejected",
] as const;
export type CatalogReviewStatus = (typeof CATALOG_REVIEW_STATUSES)[number];

export type CatalogProposal = {
	suggestedShelves: CatalogShelf[];
	suggestedAudiences: CatalogAudience[];
	capabilities: string[];
	keywords: string[];
	submittedAt: string;
	version: number;
};

export type ApprovedCatalog = {
	primaryShelf: CatalogShelf;
	secondaryShelves: CatalogShelf[];
	audiences: CatalogAudience[];
	capabilities: string[];
	maturity: CatalogMaturity;
	visibility: CatalogVisibility;
	approvedAt: string;
	approvedBy: string;
	version: number;
};

/** Presentation placement for a tool that has no approved catalog record. */
export type ExploreFallbackCatalog = Pick<
	ApprovedCatalog,
	| "primaryShelf"
	| "secondaryShelves"
	| "audiences"
	| "capabilities"
	| "maturity"
	| "visibility"
> & { reviewStatus: CatalogReviewStatus };

/** Latest submission and last approval are independent so review cannot erase approval. */
export type CatalogRecord = {
	toolId: string;
	proposal: CatalogProposal | null;
	approved: ApprovedCatalog | null;
	reviewStatus: CatalogReviewStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(
	value: unknown,
	allowed: T,
): value is T[number] {
	return typeof value === "string" && allowed.some((item) => item === value);
}

function controlledArray<const T extends readonly string[]>(
	value: unknown,
	allowed: T,
	requireNonEmpty = false,
): T[number][] | null {
	if (!Array.isArray(value) || (requireNonEmpty && value.length === 0))
		return null;
	if (!value.every((item) => isOneOf(item, allowed))) return null;
	if (new Set(value).size !== value.length) return null;
	return [...value] as T[number][];
}

function stringArray(value: unknown): string[] | null {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
		return null;
	const trimmed = value.map((item: string) => item.trim());
	if (
		trimmed.some((item) => item.length === 0) ||
		new Set(trimmed).size !== trimmed.length
	)
		return null;
	return trimmed;
}

function isTimestamp(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
	)
		return false;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isVersion(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function validateCatalogProposal(
	value: unknown,
): CatalogProposal | null {
	if (!isRecord(value)) return null;
	const suggestedShelves = controlledArray(
		value.suggestedShelves,
		CATALOG_SHELVES,
		true,
	);
	const suggestedAudiences = controlledArray(
		value.suggestedAudiences,
		CATALOG_AUDIENCES,
	);
	const capabilities = stringArray(value.capabilities);
	const keywords = stringArray(value.keywords);
	if (
		!suggestedShelves ||
		!suggestedAudiences ||
		!capabilities ||
		!keywords ||
		!isTimestamp(value.submittedAt) ||
		!isVersion(value.version)
	)
		return null;
	return {
		suggestedShelves,
		suggestedAudiences,
		capabilities,
		keywords,
		submittedAt: value.submittedAt,
		version: value.version,
	};
}

export function validateApprovedCatalog(
	value: unknown,
): ApprovedCatalog | null {
	if (
		!isRecord(value) ||
		!isOneOf(value.primaryShelf, CATALOG_SHELVES) ||
		!isOneOf(value.maturity, CATALOG_MATURITY) ||
		!isOneOf(value.visibility, CATALOG_VISIBILITY) ||
		!isTimestamp(value.approvedAt) ||
		typeof value.approvedBy !== "string" ||
		!value.approvedBy.trim() ||
		value.approvedBy !== value.approvedBy.trim() ||
		!isVersion(value.version)
	)
		return null;
	const secondaryShelves = controlledArray(
		value.secondaryShelves,
		CATALOG_SHELVES,
	);
	const audiences = controlledArray(value.audiences, CATALOG_AUDIENCES);
	const capabilities = stringArray(value.capabilities);
	if (
		!secondaryShelves ||
		secondaryShelves.includes(value.primaryShelf) ||
		!audiences ||
		!capabilities
	)
		return null;
	return {
		primaryShelf: value.primaryShelf,
		secondaryShelves,
		audiences,
		capabilities,
		maturity: value.maturity,
		visibility: value.visibility,
		approvedAt: value.approvedAt,
		approvedBy: value.approvedBy,
		version: value.version,
	};
}

/** Synthetic placement for a record with no approval; the status remains visible to callers. */
export function exploreFallbackCatalog(
	reviewStatus: CatalogReviewStatus,
): ExploreFallbackCatalog {
	return {
		primaryShelf: "explore",
		secondaryShelves: [],
		audiences: [],
		capabilities: [],
		maturity: "experimental",
		visibility: "discoverable",
		reviewStatus,
	};
}
