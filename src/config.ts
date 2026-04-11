export const cloudConfig = {
  deployUrl: process.env.NEXUS_DEPLOY_URL ?? "",
  deployToken: process.env.NEXUS_DEPLOY_TOKEN ?? "",
  apiKey: process.env.NEXUS_CLOUD_API_KEY ?? "",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};

export function hasDeployIntegration(): boolean {
  return Boolean(cloudConfig.deployUrl.trim() && cloudConfig.deployToken.trim());
}

export function requiresApiKey(): boolean {
  return Boolean(cloudConfig.apiKey.trim());
}

export function isValidApiKey(key: string): boolean {
  return Boolean(cloudConfig.apiKey.trim()) && cloudConfig.apiKey.trim() === key.trim();
}
