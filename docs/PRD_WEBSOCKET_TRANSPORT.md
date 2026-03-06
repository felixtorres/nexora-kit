# PRD: WebSocket Transport Migration

## Problem

NexoraKit currently implements the WebSocket transport layer manually in `@nexora-kit/api`. The custom handshake and frame handling are not reliably interoperating with real browsers even when REST and auth succeed. This has already caused repeated debugging loops, stalled frontend work, and low confidence in the transport layer.

The platform value is not in maintaining a low-level RFC 6455 implementation. The value is in auth, rate limits, agent streaming, routing, and plugin integration.

## Current Pain

- Browser WebSocket handshakes fail while mocked/unit tests pass
- The custom transport is expensive to debug and easy to regress
- The implementation lacks production-grade standards coverage
- Frontend and backend debugging are blocked by transport uncertainty

## Solution

Replace the custom handshake/frame implementation with the battle-tested `ws` library while preserving NexoraKit-specific behavior:

- operator WebSocket endpoint: `/v1/ws`
- client WebSocket endpoint: `/v1/agents/:slug/ws`
- auth during upgrade
- connection and rate-limit tracking
- conversation streaming envelopes
- cancellation and heartbeat behavior

## Goals

1. Browser-compatible WebSocket handshakes with no custom RFC parsing
2. Preserve the existing API contract and message envelope format
3. Keep current auth and rate-limit behavior intact
4. Add regression coverage using a real WebSocket client
5. Reduce maintenance burden and debugging time

## Non-Goals

- Changing the frontend message protocol
- Reworking agent-loop event semantics
- Introducing new product-level WebSocket features
- Replacing REST fallback behavior

## Acceptance Criteria

- [ ] `/v1/ws` upgrades successfully from a standards-compliant WebSocket client
- [ ] `/v1/agents/:slug/ws` upgrades successfully from a standards-compliant WebSocket client
- [ ] Existing JSON message types (`chat`, `ping`, `cancel`) still work
- [ ] Server still emits existing envelope format (`{ type, conversationId, payload }`)
- [ ] Auth failures still reject before connection establishment
- [ ] Rate limits and connection caps still apply
- [ ] Heartbeat/dead-peer cleanup still works
- [ ] New integration tests use a real WebSocket client instead of mocked frame parsing only

## Risks

| Risk                                              | Impact | Mitigation                                                            |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Behavior drift during migration                   | High   | Keep external message contract unchanged and add regression tests     |
| Existing tests rely on custom frame internals     | Medium | Replace internals-focused tests with client-visible integration tests |
| Subtle auth/rate-limit regressions                | High   | Add targeted tests for 401, 429, and cancellation paths               |
| Dependency introduction changes package footprint | Low    | Use a single well-known runtime dependency: `ws`                      |

## Success Metric

The frontend can connect from a real browser to the local API without handshake errors, and WebSocket behavior is validated by repeatable integration tests rather than manual debugging.
