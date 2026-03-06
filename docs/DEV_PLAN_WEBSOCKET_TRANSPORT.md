# Dev Plan: WebSocket Transport Migration

## Architecture Direction

Move NexoraKit from a hand-rolled RFC 6455 implementation to `ws` for transport handling. Keep all NexoraKit-specific logic in manager classes:

- auth during upgrade
- user/end-user connection accounting
- message parsing and validation
- rate limits
- streaming events from `agentLoop.run()`
- cancellation bookkeeping

`ws` becomes responsible for:

- handshake correctness
- protocol ping/pong behavior
- frame parsing
- masking rules
- close behavior
- browser interoperability

## Implementation Phases

### Phase 1: Dependency and API shape

- Add `ws` to `packages/api`
- Update gateway upgrade path to pass Node's `head` buffer to managers
- Preserve public manager class names where possible

### Phase 2: Operator WebSocket migration

- Refactor `packages/api/src/websocket.ts`
- Replace raw `Socket` frame handling with `WebSocketServer({ noServer: true })`
- Keep auth, connection counting, rate limits, and event streaming logic
- Keep the existing JSON message contract

### Phase 3: Client WebSocket migration

- Refactor `packages/api/src/client-websocket.ts`
- Preserve agent lookup, end-user auth, ownership checks, and rate limits
- Keep current message envelope behavior

### Phase 4: Test migration

- Replace mocked raw-frame expectations with real-client integration tests using `ws`
- Cover:
  - successful handshake
  - auth rejection
  - ping/pong
  - chat streaming
  - cancel flow
  - connection limits

### Phase 5: Validation

- Run `@nexora-kit/api` tests
- Start local server from workspace CLI
- verify browser handshake from frontend settings already in use

## Design Notes

- Do not change frontend protocol while fixing transport
- Keep app-level JSON ping support for backward compatibility
- Let `ws` handle protocol pings/pongs; NexoraKit still performs liveness tracking
- Prefer small transport helpers over repeating `ws.send(JSON.stringify(...))`

## Files Expected To Change

- `packages/api/package.json`
- `packages/api/src/gateway.ts`
- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`
- `packages/api/src/index.ts`
- `packages/api/src/*.test.ts`
- `package-lock.json`

## Verification Strategy

1. Unit/integration tests pass for `@nexora-kit/api`
2. Local server runs via `packages/cli/dist/bin.js`
3. `http://127.0.0.1:3000/v1/health` returns 200
4. Browser WebSocket no longer fails during handshake
