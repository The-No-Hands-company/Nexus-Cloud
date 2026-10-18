import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveJsonStorePath } from "../persistence/json-store";
import { CATALOG_AUDIENCES, CATALOG_SHELVES, type CatalogAudience, type CatalogShelf } from "../systems-api/catalog";
import type { NodeCatalogOverlay, NodeLocalCatalogApp } from "./resolution";

export type StoredNodeCatalogOverlay = NodeCatalogOverlay & { nodeId: string; updatedAt: string };
type State = Record<string, StoredNodeCatalogOverlay>;

function strings(value: unknown): string[] {
	return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))] : [];
}

function shelf(value: unknown): CatalogShelf | undefined {
	return typeof value === "string" && CATALOG_SHELVES.includes(value as CatalogShelf) ? value as CatalogShelf : undefined;
}

function localApp(value: unknown): NodeLocalCatalogApp | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.toolId !== "string" || !raw.toolId.trim() || typeof raw.name !== "string" || !raw.name.trim()) return null;
	const primaryShelf = shelf(raw.primaryShelf);
	const audiences = strings(raw.audiences).filter((item): item is CatalogAudience => CATALOG_AUDIENCES.includes(item as CatalogAudience));
	return {
		toolId: raw.toolId,
		name: raw.name,
		description: typeof raw.description === "string" ? raw.description : "",
		...(primaryShelf ? { primaryShelf } : {}),
		secondaryShelves: strings(raw.secondaryShelves).filter((item): item is CatalogShelf => Boolean(shelf(item))),
		audiences,
		capabilities: strings(raw.capabilities),
		maturity: raw.maturity === "stable" || raw.maturity === "preview" || raw.maturity === "experimental" ? raw.maturity : "experimental",
		visibility: raw.visibility === "default" || raw.visibility === "restricted" || raw.visibility === "hidden" || raw.visibility === "discoverable" ? raw.visibility : "discoverable",
		canLaunch: raw.canLaunch === true,
	};
}

function sanitize(value: unknown): State {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const state: State = {};
	for (const [nodeId, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const record = raw as Record<string, unknown>;
		const shelfOverrides: Record<string, CatalogShelf> = {};
		if (record.shelfOverrides && typeof record.shelfOverrides === "object" && !Array.isArray(record.shelfOverrides)) {
			for (const [toolId, value] of Object.entries(record.shelfOverrides as Record<string, unknown>)) {
				const selected = shelf(value);
				if (selected) shelfOverrides[toolId] = selected;
			}
		}
		state[nodeId] = {
			nodeId,
			disabledAppIds: strings(record.disabledAppIds),
			shelfOverrides,
			localApps: Array.isArray(record.localApps) ? record.localApps.map(localApp).filter((app): app is NodeLocalCatalogApp => app !== null) : [],
			updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
		};
	}
	return state;
}

export class NodeCatalogOverlayStore {
	private readonly path: string;
	private state: State;

	constructor(path = resolveJsonStorePath(join("data", "catalog-node-overlays.json"), "NEXUS_CLOUD_NODE_CATALOG_PATH")) {
		this.path = path;
		this.state = this.load();
	}

	get(nodeId: string): StoredNodeCatalogOverlay | null {
		const record = this.state[nodeId];
		return record ? structuredClone(record) : null;
	}

	upsert(nodeId: string, patch: NodeCatalogOverlay): StoredNodeCatalogOverlay {
		if (!nodeId.trim()) throw new Error("nodeId is required");
		const current = this.state[nodeId];
		const localApps = patch.localApps ?? current?.localApps ?? [];
		if (localApps.some((app) => app.toolId === "platform")) throw new Error("node overlays cannot claim platform scope");
		const record: StoredNodeCatalogOverlay = {
			nodeId,
			disabledAppIds: strings(patch.disabledAppIds ?? current?.disabledAppIds),
			shelfOverrides: { ...(current?.shelfOverrides ?? {}), ...(patch.shelfOverrides ?? {}) },
			localApps: localApps.map((app) => structuredClone(app)),
			updatedAt: new Date().toISOString(),
		};
		this.state[nodeId] = record;
		this.save();
		return structuredClone(record);
	}

	private load(): State {
		if (!existsSync(this.path)) return {};
		try { return sanitize(JSON.parse(readFileSync(this.path, "utf8"))); } catch { return {}; }
	}

	private save(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
		renameSync(temp, this.path);
	}
}

export function resolveNodeOverlay(store: NodeCatalogOverlayStore, nodeId: string): NodeCatalogOverlay {
	const record = store.get(nodeId);
	return record ? { disabledAppIds: [...(record.disabledAppIds ?? [])], shelfOverrides: { ...(record.shelfOverrides ?? {}) }, localApps: structuredClone(record.localApps ?? []) } : {};
}
