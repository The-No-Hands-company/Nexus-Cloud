import type { SystemsApiMode, SystemsApiPublicUrl, SystemsApiStatus, SystemsApiTool } from "./types";

export type SystemsApiToolListResponseDTO = {
  tools: readonly SystemsApiTool[];
};

export type SystemsApiStatusResponseDTO = {
  status: SystemsApiStatus;
  tools: readonly SystemsApiTool[];
  publicUrls: readonly SystemsApiPublicUrl[];
};

export type SystemsApiPublicUrlRequestDTO = {
  toolId: string;
  desiredHost?: string;
  refresh?: boolean;
};

export type SystemsApiPublicUrlResponseDTO = {
  publicUrl: SystemsApiPublicUrl;
  tool: SystemsApiTool;
};

export type SystemsApiToolRegistrationRequestDTO = {
  id: string;
  name: string;
  description: string;
  mode?: SystemsApiMode;
  exposed?: boolean;
  capabilities?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isMode(value: unknown): value is SystemsApiMode {
  return value === "standalone" || value === "orchestrated";
}

export function isSystemsApiToolRegistrationRequest(value: unknown): value is SystemsApiToolRegistrationRequestDTO {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && (value.mode === undefined || isMode(value.mode))
    && (value.exposed === undefined || isBoolean(value.exposed))
    && (value.capabilities === undefined || isStringArray(value.capabilities));
}

export function isSystemsApiPublicUrlRequest(value: unknown): value is SystemsApiPublicUrlRequestDTO {
  return isRecord(value)
    && isString(value.toolId)
    && (value.desiredHost === undefined || isString(value.desiredHost))
    && (value.refresh === undefined || isBoolean(value.refresh));
}
