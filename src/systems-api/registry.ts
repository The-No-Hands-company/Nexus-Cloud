import type { SystemsApiMode, SystemsApiPublicUrl, SystemsApiStatus, SystemsApiTool, SystemsApiToolExposure, SystemsApiToolHealth } from "./types";

export type SystemsApiToolRegistrationInput = {
  id: string;
  name: string;
  description: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  health?: SystemsApiToolHealth;
  capabilities?: readonly string[];
  publicUrl?: string;
};

export type SystemsApiPublicUrlRequest = {
  toolId: string;
  desiredHost?: string;
  refresh?: boolean;
};

const tools: SystemsApiTool[] = [];
const publicUrls: SystemsApiPublicUrl[] = [];

function now(): string {
  return new Date().toISOString();
}

function currentMode(): SystemsApiMode {
  return process.env.SYSTEMS_API_MODE === "orchestrated" ? "orchestrated" : "standalone";
}

function exposureFromFlag(exposed: boolean): SystemsApiToolExposure {
  return exposed ? "public" : "private";
}

function buildPublicUrl(toolId: string, desiredHost?: string): string {
  const host = desiredHost?.trim() || `${toolId}.nexus.local`;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

function findToolIndex(toolId: string): number {
  return tools.findIndex((tool) => tool.id === toolId);
}

export function listTools(): readonly SystemsApiTool[] {
  return tools;
}

export function getTool(toolId: string): SystemsApiTool | null {
  return tools.find((tool) => tool.id === toolId) ?? null;
}

export function upsertTool(input: SystemsApiToolRegistrationInput): SystemsApiTool {
  const existingIndex = findToolIndex(input.id);
  const previous = existingIndex >= 0 ? tools[existingIndex] : null;
  const tool: SystemsApiTool = {
    id: input.id,
    name: input.name,
    description: input.description,
    mode: input.mode ?? previous?.mode ?? currentMode(),
    exposed: input.exposed ?? previous?.exposed ?? false,
    exposure: exposureFromFlag(input.exposed ?? previous?.exposed ?? false),
    health: input.health ?? previous?.health ?? "healthy",
    capabilities: input.capabilities ?? previous?.capabilities ?? [],
    publicUrl: input.publicUrl ?? previous?.publicUrl,
    registeredAt: previous?.registeredAt ?? now(),
    updatedAt: now(),
  };

  if (existingIndex >= 0) {
    tools[existingIndex] = tool;
  } else {
    tools.push(tool);
  }

  return tool;
}

export function setToolExposure(toolId: string, exposed: boolean): SystemsApiTool | null {
  const existing = getTool(toolId);
  if (!existing) {
    return null;
  }

  return upsertTool({
    id: existing.id,
    name: existing.name,
    description: existing.description,
    mode: existing.mode,
    exposed,
    health: existing.health,
    capabilities: existing.capabilities,
    publicUrl: existing.publicUrl,
  });
}

export function requestPublicUrl(input: SystemsApiPublicUrlRequest): SystemsApiPublicUrl | null {
  const tool = getTool(input.toolId);
  if (!tool) {
    return null;
  }

  const url = buildPublicUrl(tool.id, input.desiredHost);
  const record: SystemsApiPublicUrl = {
    toolId: tool.id,
    url,
    status: "active",
    issuedAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };

  const existingIndex = publicUrls.findIndex((item) => item.toolId === tool.id);
  if (existingIndex >= 0 && !input.refresh) {
    publicUrls[existingIndex] = {
      ...publicUrls[existingIndex],
      url,
      status: "active",
      issuedAt: now(),
      expiresAt: record.expiresAt,
    };
  } else if (existingIndex >= 0) {
    publicUrls[existingIndex] = record;
  } else {
    publicUrls.push(record);
  }

  upsertTool({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    mode: tool.mode,
    exposed: true,
    health: tool.health,
    capabilities: tool.capabilities,
    publicUrl: url,
  });

  return record;
}

export function listPublicUrls(): readonly SystemsApiPublicUrl[] {
  return publicUrls;
}

export function describeStatus(): SystemsApiStatus {
  const mode = currentMode();
  const toolCount = tools.length;
  const exposedToolCount = tools.filter((tool) => tool.exposed).length;
  const healthyToolCount = tools.filter((tool) => tool.health === "healthy").length;
  return {
    version: "v1",
    mode,
    toolCount,
    exposedToolCount,
    healthyToolCount,
    publicUrlCount: publicUrls.length,
    updatedAt: now(),
  };
}
