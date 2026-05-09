# Nexus Cloud

Nexus-Cloud is the control plane and nerve system for the entire ecosystem.

## Standards Enforcement

- Follow ../docs/ENGINEERING_STANDARDS.md for runtime, API, observability, testing, and security requirements.
- Preserve the architectural rule that service registration, heartbeat, topology, routing intent, and ecosystem coordination converge here.
- Prefer event-driven integration over polling. If another service can emit a webhook, SSE update, queue event, or heartbeat, consume that instead of adding periodic polling loops.
- Preserve local-first and degraded-mode behavior for downstream services: Nexus-Cloud coordinates the ecosystem but should not force every client into hard dependency on synchronous control-plane round-trips.

## Repo Conventions

- Runtime is Bun + strict TypeScript.
- Biome is the required lint/format tool.
- Keep cross-service payloads typed, versioned, and documented.
- Avoid ad hoc JSON shapes or hidden env-var coupling between services.

## Validation Target

- `bun run check`
- `bun test src`
