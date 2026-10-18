import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveJsonStorePath } from "../persistence/json-store";
import type { TenantCatalogEntitlements } from "./resolution";

export type StoredTenantCatalogEntitlements = TenantCatalogEntitlements & { tenantId: string; updatedAt: string };
type State = Record<string, StoredTenantCatalogEntitlements>;

const DEFAULT_STATE: State = {};

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

function sanitize(value: unknown): State {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result: State = {};
	for (const [tenantId, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const record = raw as Record<string, unknown>;
		result[tenantId] = {
			tenantId,
			enabledAppIds: ids(record.enabledAppIds),
			disabledAppIds: ids(record.disabledAppIds),
			updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
		};
	}
	return result;
}

export class TenantCatalogEntitlementsStore {
	private readonly path: string;
	private state: State;

	constructor(path = resolveJsonStorePath(join("data", "catalog-tenant-entitlements.json"), "NEXUS_CLOUD_TENANT_CATALOG_PATH")) {
		this.path = path;
		this.state = this.load();
	}

	get(tenantId: string): StoredTenantCatalogEntitlements | null {
		const record = this.state[tenantId];
		return record ? { ...record, enabledAppIds: [...(record.enabledAppIds ?? [])], disabledAppIds: [...(record.disabledAppIds ?? [])] } : null;
	}

	upsert(tenantId: string, patch: TenantCatalogEntitlements): StoredTenantCatalogEntitlements {
		if (!tenantId.trim()) throw new Error("tenantId is required");
		const current = this.state[tenantId];
		const record: StoredTenantCatalogEntitlements = {
			tenantId,
			enabledAppIds: ids(patch.enabledAppIds ?? current?.enabledAppIds),
			disabledAppIds: ids(patch.disabledAppIds ?? current?.disabledAppIds),
			updatedAt: new Date().toISOString(),
		};
		this.state[tenantId] = record;
		this.save();
		return this.get(tenantId)!;
	}

	private load(): State {
		if (!existsSync(this.path)) return { ...DEFAULT_STATE };
		try { return sanitize(JSON.parse(readFileSync(this.path, "utf8"))); } catch { return { ...DEFAULT_STATE }; }
	}

	private save(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
		renameSync(temp, this.path);
	}
}

export function resolveTenantEntitlements(store: TenantCatalogEntitlementsStore, tenantId: string): TenantCatalogEntitlements {
		const record = store.get(tenantId);
		return record ? { enabledAppIds: [...(record.enabledAppIds ?? [])], disabledAppIds: [...(record.disabledAppIds ?? [])] } : {};
}
