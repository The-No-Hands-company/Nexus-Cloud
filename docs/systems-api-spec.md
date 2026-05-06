# Nexus Systems API Spec

## Purpose

The Nexus Systems API is the canonical platform API for Nexus Cloud. It provides a normalized interface for clients, tools, agents, and external integrations to discover capabilities, inspect status, request public exposure, and trigger safe platform actions.

## Design goals

- One stable contract for the ecosystem
- Privacy-first by default
- Explicit versioning
- Thin clients, strong server-side validation
- Compatible with standalone mode and orchestrated mode
- Clear separation between live runtime registry data and wider ecosystem topology data

## Core v1 scope

The first version should focus on three platform primitives:

- `GET /api/v1/tools`
- `GET /api/v1/status`
- `POST /api/v1/public-url`

The current control surface also includes canonical topology endpoints for ecosystem awareness:

- `GET /api/v1/apps`
- `GET /api/v1/connections`
- `GET /api/v1/topology`

These endpoints are backed by a tool registry and status model that can be shared across standalone tools and orchestrated services.

## Registry versus topology

Nexus Cloud maintains two different but related views:

- The tool registry is runtime-oriented. It describes tools that have actually registered, exposed routes, or reported health into Cloud.
- The topology graph is ecosystem-oriented. It describes the broader Nexus Systems application graph, including projects that are integrated deeply, integrated shallowly, or still being wired up.

This separation prevents architecture discovery from being coupled to whether a service happens to be running right now.

## Deploy integration

Nexus Cloud can also call Nexus Deploy as a formal service-to-service integration.

### Required environment variables

- `NEXUS_DEPLOY_URL` — base URL of the Nexus Deploy instance
- `NEXUS_DEPLOY_TOKEN` — bearer token used for service-to-service authentication

### Deploy contract

- `GET /api/v1/deployments/integration` — describe the Deploy integration contract
- `POST /api/v1/deployments` — request a managed deployment from Nexus Deploy

The request shape mirrors the shared Systems API deploy DTO and includes:

- `toolId`
- `repo`
- optional `name`, `branch`, `buildCommand`, `startCommand`, `volumePath`, `port`
- optional `env`, `customDomain`, `autoDeployEnabled`, `notifyUrl`
- optional `deployNow`, `commitSha`

## Tool registry model

Each tool entry should capture:

- stable tool identity
- display name and description
- exposure state
- operating mode (`standalone` or `orchestrated`)
- health state
- capability tags
- optional public URL
- timestamps for registration and last update

### PHANTOM security profile contract

Tools can publish an optional `phantomSecurityProfile` during:

- `POST /api/v1/tools`
- `PATCH /api/v1/tools/:toolId`
- `POST /api/v1/tools/:toolId/heartbeat`

Profile shape:

- `claimedSecured` (boolean)
- `protectionLevel` (`transitional` | `hardened` | `maximum`)
- `guarantees.postQuantum` (boolean)
- `guarantees.fheTransport` (boolean)
- `guarantees.zkProofs` (boolean)
- optional `metadata` object:
  - `pqAlgorithms` (string[])
  - `fheScheme` (string)
  - `zkProofSystem` (string)
  - `proofAttestation` (string)
  - `proofEndpoint` (string)
  - `lastVerifiedAt` (ISO string)

When `claimedSecured=true`, Cloud treats all cryptographic guarantees and proof metadata above as required for compliance.

## Status model

The status endpoint should return a normalized summary including:

- API version
- runtime mode
- total tool count
- exposed tool count
- healthy tool count
- public URL count
- last update timestamp

### PHANTOM compliance status fields

`GET /api/v1/status` includes PHANTOM compliance counters and failure details:

- `phantomSecuredClaimedCount`
- `phantomSecuredCompliantCount`
- `failedIntegrationCount`
- `integrationStatus` (`healthy` | `failing`)
- `integrationFailures[]` with `toolId` and failure reason

Failure semantics:

- If a tool claims `claimedSecured=true` but omits required guarantee/proof metadata, it is marked as a failing integration.
- Any failing claimed-secured tool flips global `integrationStatus` to `failing`.
- Route tagging remains `transitional` for non-compliant claims, and `phantom-hardened` only for compliant claims.

Operator filters:

- `GET /api/v1/tools?phantomCompliance=failing` returns only failing claimed-secured tools.
- `GET /api/v1/status?phantomCompliance=failing` keeps status summary but limits the `tools` array to failing claimed-secured tools.
- `GET /api/v1/compliance/phantom?status=failing|all` returns dashboard-ready compliance entries and failures.
- `GET /api/v1/compliance/phantom/summary` returns counts only (`claimedSecuredCount`, `compliantCount`, `failingCount`, `status`) for lightweight high-frequency polling.

### Status polling migration and deprecation window

Trust-aware dashboard polling now has two compact forms:

- `GET /api/v1/status?compact=trust`
- `GET /api/v1/trust/summary`

Preferred migration path for existing clients:

1. Switch current `GET /api/v1/status` polling to `GET /api/v1/status?compact=trust`.
2. Fall back to `GET /api/v1/trust/summary` if compact query mode is unavailable.

Compatibility policy:

- The full `GET /api/v1/status` response remains supported for one release cycle for dashboard clients that have not yet migrated.
- During that compatibility window, new dashboard work should prefer compact polling over the full status payload.
- After the compatibility window, high-frequency dashboard polling against the full status payload should be treated as deprecated behavior, though the endpoint itself remains valid for broader operational inspection.

Polling optimization:

- `GET /api/v1/status`
- `GET /api/v1/status?compact=trust`
- `GET /api/v1/trust/summary`
- `GET /api/v1/compliance/phantom/summary`

all support conditional polling via `ETag` and `If-None-Match`.

## Public URL model

Public URL issuance should:

- resolve a tool by ID
- create or refresh an exposure record
- return the canonical URL and expiration window
- keep the endpoint safe for future orchestration and edge integration

## Authentication

### User-facing requests

Use bearer token auth for authenticated client requests.

### Service-to-service requests

Use signed internal requests when tools or peers call through Nexus Cloud on behalf of another service.

### Federation requests

Federated peers must use signed requests and explicit trust relationships.

## Error format

Errors should return JSON in this shape:

```json
{
  "error": "human readable message"
}
```

Implementations may add a `details` object for validation errors when needed.

## Runtime model

The Systems API should live inside Nexus Cloud first, backed by a shared registry/service layer, then later be extracted into a shared SDK for standalone tools.

## Contract artifact ownership

Parallel execution model for Wave P0:

- Runtime source of truth: `apps/Nexus-Cloud/src/systems-api/`
- Contract artifact source of truth: `apps/Nexus-Systems-API/src/`

Required sync rule:

- Any endpoint or DTO change in the runtime module must be reflected in the artifact workspace endpoint map, typed DTO definitions, and example payload set in the same implementation wave.

Current direct consumers for this contract stream:

- Nexus Auth
- Nexus Vault
- Nexus Guardian
- Nexus Tunnel
- Nexus Edge

## Non-goals for v1

- GraphQL
- arbitrary cross-tool CRUD
- hidden telemetry
- implicit background mutations
- vendor-specific auth flows

## Address Kinds

The status endpoint includes a `addressKinds` field that lists the supported public address types. Clients and UI docs can read this field and pull the canonical list instead of hardcoding it.

The supported kinds are:

- `website` – HTTPS website hostnames (also powers the compatibility `POST /api/v1/public-url`).
- `email` – mailbox-style identifiers for messaging-facing services.
- `server` – opaque server handles (e.g., `nexus://tools/gateway`).
- `custom` – user-defined address formats for future protocols.
