/**
 * Phantom DID Registry
 *
 * Services register their post-quantum public keys here at startup.
 * Callers resolve a DID to its signing public key to verify Dilithium-5
 * signatures without any external infrastructure.
 */

export interface PhantomRegistryEntry {
  did: string;
  appName: string;
  signingPublicKey: string; // hex-encoded Dilithium-5 public key
  kemPublicKey: string;     // hex-encoded Kyber-1024 public key
  registeredAt: number;     // unix ms
  lastSeenAt: number;
}

const registry = new Map<string, PhantomRegistryEntry>();

export function registerDid(entry: Omit<PhantomRegistryEntry, "registeredAt" | "lastSeenAt">): void {
  const existing = registry.get(entry.did);
  registry.set(entry.did, {
    ...entry,
    registeredAt: existing?.registeredAt ?? Date.now(),
    lastSeenAt: Date.now(),
  });
}

export function resolveDid(did: string): PhantomRegistryEntry | undefined {
  return registry.get(did);
}

export function listRegistered(): PhantomRegistryEntry[] {
  return Array.from(registry.values()).sort((a, b) => a.appName.localeCompare(b.appName));
}

export function registrySize(): number {
  return registry.size;
}
