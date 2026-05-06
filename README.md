# Nexus Cloud

Self-hosted, federated cloud infrastructure and ecosystem hub for The No Hands Company.

## Purpose

This repository is the control layer for the Nexus Systems ecosystem. Nexus Cloud is where the ecosystem gets a shared control plane, a canonical topology map, stable discovery, public exposure contracts, and a place to coordinate deeper or shallower integrations across the rest of the stack without relying on hyperscalers.

## Ecosystem scope

Nexus Cloud currently treats these projects as the active Nexus Systems ecosystem under development:

- Nexus Cloud
- Nexus
- Nexus AI
- Nexusclaw
- Nexus Computer
- Nexus Deploy
- Nexus Forge
- Nexus Hosting
- Nexus Network
- Nexus Porter
- Nexus Vault
- Nit
- Phantom

The canonical ecosystem inventory and integration depth map lives in `docs/ecosystem-map.md`.
The production-readiness backlog lives in `docs/production-readiness.md`.

## Architecture scaffold

- `src/architecture.ts` defines the project shape
- `src/control-plane/` holds identity, scheduling, quota, and policy boundaries
- `src/data-plane/` holds runtime and workload boundaries
- `src/federation/` holds trust and peer routing boundaries
- `src/storage/` holds storage classes and volume models
- `src/observability/` holds metrics, logs, traces, and audit boundaries
- `src/api/` defines the initial API surface
- `src/systems-api/` defines the shared platform contract for tools, topology, and services
- `docs/architecture.md` describes the first implementation cut
- `docs/implementation-plan.md` is the living roadmap for current and future work

## Overview model

Nexus Cloud exposes two distinct views of the ecosystem:

- The live tool registry for services that are actually registered, exposed, and heartbeat-aware right now
- The canonical topology graph for the wider ecosystem, including projects that are integrated deeply, integrated shallowly, or still being wired up

That split keeps runtime truth separate from product and architecture truth.

## Deploy integration

- Set `NEXUS_DEPLOY_URL` and `NEXUS_DEPLOY_TOKEN` in your environment to let Nexus Cloud call Nexus Deploy as a service-to-service client.
- The formal contract is documented in `docs/systems-api-spec.md`.
- A small deploy trigger page is available at `public/deploy.html` for quick operator use.

## Testing

- Run the suite with `bun test src`
- Keep shared test helpers in `src/test/`
- Prefer `*.test.ts` next to the module for DTO and unit coverage
- Use `src/test/` for shared harnesses and cross-module route/service behavior
- Keep the route manifest, router handlers, DTOs, and service behavior covered together when changing the Systems API

## Next steps

- Keep the topology graph aligned with the real ecosystem inventory
- Turn the production-readiness backlog into implementation phases
- Replace in-memory platform state with durable state and recovery paths
- Complete Guardian, observability, data-plane, and storage subsystems
- Deepen live registration flows for tools that should move from referenced to active integration
