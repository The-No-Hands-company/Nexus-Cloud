# Nexus Cloud Architecture Scaffold

## Project goal

Nexus Cloud is a self-hosted, federated cloud platform and central ecosystem hub for The No Hands Company.

## Core layers

### Control plane

Owns identity, registration, scheduling, policy, quota, and placement.

### Data plane

Runs workloads with clear runtime boundaries and pluggable execution targets.

### Federation layer

Handles trust, discovery, signed routing, and cross-cluster communication.

### Storage layer

Provides object, block, and snapshot storage with replication and retention policies.

### Observability

Tracks metrics, logs, traces, and audit trails for operators.

### Systems API

Provides the canonical contract for tools, services, shared status, exposure, and platform-level integration.

### Ecosystem topology

Provides the canonical graph of the wider Nexus Systems ecosystem so Nexus Cloud can describe what exists, how it relates, and whether a tool is deeply embedded, hybrid, or only referenced today.

The topology graph is intentionally broader than the live tool registry. The registry answers what is registered and currently active. The topology answers what belongs to the ecosystem and how Cloud expects to integrate with it.

## Initial API surface

- `GET /health`
- `GET /v1/architecture`
- `POST /v1/nodes/register`
- `POST /v1/workloads/plan`
- `GET /v1/federation/peers`
- `POST /v1/federation/peers/:domain/trust`
- `GET /api/v1/apps`
- `GET /api/v1/connections`
- `GET /api/v1/topology`
