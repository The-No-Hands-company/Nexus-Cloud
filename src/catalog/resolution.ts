import type {
	ApprovedCatalog,
	CatalogAudience,
	CatalogMaturity,
	CatalogReviewStatus,
	CatalogShelf,
	CatalogVisibility,
} from "../systems-api/catalog";

export type GlobalCatalogEntry = {
	toolId: string;
	name?: string;
	description?: string;
	approved: ApprovedCatalog | null;
	reviewStatus: CatalogReviewStatus;
};

export type CatalogRuntimeState = {
	health?: "healthy" | "degraded" | "offline";
	canLaunch: boolean;
};

export type TenantCatalogEntitlements = {
	enabledAppIds?: readonly string[];
	disabledAppIds?: readonly string[];
};

export type NodeLocalCatalogApp = {
	toolId: string;
	name: string;
	description?: string;
	primaryShelf?: CatalogShelf;
	secondaryShelves?: CatalogShelf[];
	audiences?: CatalogAudience[];
	capabilities?: string[];
	maturity?: CatalogMaturity;
	visibility?: CatalogVisibility;
	canLaunch?: boolean;
};

export type NodeCatalogOverlay = {
	disabledAppIds?: readonly string[];
	shelfOverrides?: Readonly<Record<string, CatalogShelf>>;
	localApps?: readonly NodeLocalCatalogApp[];
};

export type CatalogUserPreferences = {
	pinnedIds?: readonly string[];
	recentIds?: readonly string[];
	preferredShelf?: CatalogShelf;
};

export type CatalogResolutionContext = {
	tenantEntitlements?: TenantCatalogEntitlements;
	nodeOverlay?: NodeCatalogOverlay;
	runtime?: Readonly<Record<string, CatalogRuntimeState | undefined>>;
	userPreferences?: CatalogUserPreferences;
};

export type EffectiveCatalogEntry = {
	toolId: string;
	name: string;
	description: string;
	primaryShelf: CatalogShelf;
	secondaryShelves: CatalogShelf[];
	audiences: CatalogAudience[];
	capabilities: string[];
	maturity: CatalogMaturity;
	visibility: CatalogVisibility;
	reviewStatus: CatalogReviewStatus;
	scope: "platform" | "node";
	availability: "available" | "disabled" | "offline" | "restricted";
	canLaunch: boolean;
	preferredByUser: boolean;
};

const fallback = (reviewStatus: CatalogReviewStatus) => ({
	primaryShelf: "explore" as const,
	secondaryShelves: [],
	audiences: [],
	capabilities: [],
	maturity: "experimental" as const,
	visibility: "discoverable" as const,
	reviewStatus,
});

function sortByPreference(entries: EffectiveCatalogEntry[], preferences: CatalogUserPreferences): EffectiveCatalogEntry[] {
	const pinned = new Map((preferences.pinnedIds ?? []).map((id, index) => [id, index]));
	const recent = new Map((preferences.recentIds ?? []).map((id, index) => [id, index]));
	return [...entries].sort((a, b) => {
		const rank = (entry: EffectiveCatalogEntry) => {
			if (pinned.has(entry.toolId)) return [0, pinned.get(entry.toolId)!] as const;
			if (recent.has(entry.toolId)) return [1, recent.get(entry.toolId)!] as const;
			return [2, 0] as const;
		};
		const ar = rank(a);
		const br = rank(b);
		return ar[0] - br[0] || ar[1] - br[1] || a.name.localeCompare(b.name) || a.toolId.localeCompare(b.toolId);
	});
}

/**
 * Resolve the catalog without mutating any source layer. Placement is
 * presentation metadata; entitlement, node policy, runtime health, and the
 * app's own access decision determine launchability.
 */
export function resolveEffectiveCatalog(
	globalEntries: readonly GlobalCatalogEntry[],
	context: CatalogResolutionContext = {},
): EffectiveCatalogEntry[] {
	const tenant = context.tenantEntitlements ?? {};
	const node = context.nodeOverlay ?? {};
	const runtime = context.runtime ?? {};
	const preferences = context.userPreferences ?? {};
	const disabledByTenant = new Set(tenant.disabledAppIds ?? []);
	const enabledByTenant = tenant.enabledAppIds?.length ? new Set(tenant.enabledAppIds) : null;
	const disabledByNode = new Set(node.disabledAppIds ?? []);
	const entries: EffectiveCatalogEntry[] = [];

	for (const global of globalEntries) {
		const placement = global.approved ?? fallback(global.reviewStatus);
		const override = node.shelfOverrides?.[global.toolId];
		const primaryShelf = override ?? placement.primaryShelf;
		const runtimeState = runtime[global.toolId];
		const restricted = placement.visibility === "restricted";
		const disabled = disabledByTenant.has(global.toolId) || (enabledByTenant !== null && !enabledByTenant.has(global.toolId)) || disabledByNode.has(global.toolId);
		const offline = runtimeState?.health === "offline";
		const availability = restricted ? "restricted" : disabled ? "disabled" : offline ? "offline" : "available";
		entries.push({
			toolId: global.toolId,
			name: global.name ?? global.toolId,
			description: global.description ?? "",
			primaryShelf,
			secondaryShelves: [...placement.secondaryShelves],
			audiences: [...placement.audiences],
			capabilities: [...placement.capabilities],
			maturity: placement.maturity,
			visibility: placement.visibility,
			reviewStatus: global.reviewStatus,
			scope: "platform",
			availability,
			canLaunch: availability === "available" && global.reviewStatus === "approved" && runtimeState?.canLaunch !== false,
			preferredByUser: preferences.preferredShelf === primaryShelf,
		});
	}

	for (const local of node.localApps ?? []) {
		if (entries.some((entry) => entry.toolId === local.toolId)) continue;
		const primaryShelf = node.shelfOverrides?.[local.toolId] ?? local.primaryShelf ?? "explore";
		const offline = runtime[local.toolId]?.health === "offline";
		const disabled = disabledByNode.has(local.toolId);
		const availability = disabled ? "disabled" : offline ? "offline" : "available";
		entries.push({
			toolId: local.toolId,
			name: local.name,
			description: local.description ?? "",
			primaryShelf,
			secondaryShelves: [...(local.secondaryShelves ?? [])],
			audiences: [...(local.audiences ?? [])],
			capabilities: [...(local.capabilities ?? [])],
			maturity: local.maturity ?? "experimental",
			visibility: local.visibility ?? "discoverable",
			reviewStatus: "pending",
			scope: "node",
			availability,
			canLaunch: availability === "available" && local.canLaunch === true && runtime[local.toolId]?.canLaunch !== false,
			preferredByUser: preferences.preferredShelf === primaryShelf,
		});
	}

	return sortByPreference(entries, preferences);
}
