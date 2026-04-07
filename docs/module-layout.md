# Nexus Cloud Module Layout

## Current implementation layout

```text
src/
  api/
    dto.ts
    handlers.ts
    router.ts
    index.ts
  control-plane/
    identity.ts
    placement.ts
    policy.ts
    quota.ts
    registration.ts
    scheduler.ts
    service.ts
    types.ts
  data-plane/
    index.ts
  federation/
    index.ts
    peers.ts
    service.ts
  observability/
    index.ts
    service.ts
  storage/
    index.ts
  systems-api/
    dto.ts
    index.ts
    registry.ts
    service.ts
    types.ts
  architecture.ts
  state.ts
  server.ts
```

## Responsibility boundaries

### `api/`

Owns HTTP-facing code only.

- `dto.ts` defines request and response contracts plus validation guards
- `handlers.ts` contains route-specific logic and serialization
- `router.ts` is a thin transport entrypoint
- `index.ts` exposes route metadata and public API surface summaries

### `control-plane/`

Owns identity, registration, scheduling, policy, quota, placement, and stateful orchestration.

### `federation/`

Owns trust relationships, peer registration, and federation summaries.

### `observability/`

Owns signals, event recording, and observability summaries.

### `systems-api/`

Owns the canonical platform contract, tool registry, status model, and public URL exposure primitives.

### `data-plane/`

Owns runtime execution abstractions.

### `storage/`

Owns storage classes and volume abstractions.

## Next expansion pass

When the Systems API starts growing, keep adding focused submodules rather than expanding the router:

- `src/systems-api/auth.ts` for session and token policy helpers
- `src/systems-api/public-url.ts` for exposure and tunnel orchestration
- `src/tools/` for tool-specific lifecycle adapters if needed later

## Rule of thumb

If a module parses HTTP, it belongs in `api/`.
If a module decides platform behavior, it belongs in a service layer.
If a module only models data, it belongs in a types or domain file.
