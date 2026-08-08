import { createHash } from "node:crypto";
import { cloudConfig } from "./config";

export * from "./control-plane/identity";

export type NodeIdentity = {
  did: string;
  shortId: string;
};

let cachedIdentity: NodeIdentity | null = null;

function deriveDidSeed(): string {
  const explicit = process.env.NEXUS_CLOUD_NODE_DID?.trim();
  if (explicit) return explicit;
  const base = `${cloudConfig.cloudDomain}:${process.env.HOSTNAME || "localhost"}:${process.env.PORT || "8787"}`;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 32);
  return `did:nexus:${digest}`;
}

function deriveShortId(did: string): string {
  return createHash("sha256").update(did).digest("hex").slice(0, 8);
}

export function getNodeIdentity(): NodeIdentity {
  if (cachedIdentity) return cachedIdentity;
  const did = deriveDidSeed();
  cachedIdentity = {
    did,
    shortId: deriveShortId(did),
  };
  return cachedIdentity;
}
