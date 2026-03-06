# WebSocket Implementation Review

Date: 2026-03-06

## Scope

Reviewed the custom WebSocket implementation in:

- `packages/api/src/gateway.ts`
- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`
- `packages/api/src/ws-utils.ts`

This review focuses on RFC 6455 compliance, browser interoperability, and production hardening.

## Current Situation

The project uses a hand-rolled WebSocket upgrade and frame parser instead of a proven implementation such as `ws`.

Observed in local testing:

- HTTP auth works against `http://127.0.0.1:3000`
- the server returns `101 Switching Protocols`
- browsers still reject the connection with `Incorrect 'Sec-WebSocket-Accept' header value`
- there is no automated browser-level interoperability test covering the upgrade path

This means there is at least one interoperability gap that unit tests do not currently catch.

## Major Gaps

### 1. No real browser interoperability coverage

Files:

- `packages/api/src/websocket.test.ts`
- `packages/api/src/client-websocket.test.ts`

Current tests validate mocked sockets and basic frame behavior, but they do not validate the implementation against:

- a real browser engine
- a standards-oriented WebSocket client
- the Autobahn WebSocket test suite

Impact:

- handshake bugs can ship even when unit tests pass
- browser-only failures are hard to diagnose

Recommendation:

- add browser handshake tests using Playwright
- add at least one standards client test using `ws`
- run Autobahn tests before treating the custom implementation as production-ready

### 2. Upgrade handler ignores the `head` buffer

File:

- `packages/api/src/gateway.ts`

Current code listens on `server.on('upgrade', (req, socket) => ...)` and drops the third `head` argument entirely.

Why this matters:

- Node may already have read part of the first WebSocket frame into `head`
- dropping it can lose client data that arrived with the handshake
- this is a correctness bug for any low-level custom server

Recommendation:

- accept `head` in the upgrade handler
- pass it into the WebSocket manager and feed it into the receive buffer before waiting for the first `data` event

### 3. Handshake validation is incomplete

Files:

- `packages/api/src/gateway.ts`
- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`

Current implementation validates only a subset of the required handshake fields.

Missing or weak checks:

- no validation of `Connection` containing `Upgrade`
- no validation of `Sec-WebSocket-Version: 13`
- no validation that the request method is `GET`
- no validation or policy for browser `Origin`
- `isWebSocketUpgrade()` checks only the `Upgrade` header

Impact:

- accepts malformed upgrade requests
- weakens browser security posture
- makes proxy/intermediary bugs harder to diagnose

Recommendation:

- validate method, version, `Upgrade`, and `Connection` tokens explicitly
- reject unsupported versions with the proper HTTP response
- add an `Origin` allowlist for browser clients

### 4. Frame parser accepts protocol-invalid client frames

File:

- `packages/api/src/ws-utils.ts`

Current parser behavior:

- unmasked client frames are accepted
- RSV bits are not validated
- fragmentation is not supported
- continuation frames are not supported
- control-frame rules are not enforced
- text payload UTF-8 validity is not checked

Why this matters:

- RFC 6455 requires client frames to be masked
- control frames must be unfragmented and <= 125 bytes
- invalid frames should result in protocol-close behavior, not silent acceptance

Recommendation:

- reject unmasked client frames with close code `1002`
- validate RSV bits unless an extension was negotiated
- add fragmentation support or explicitly close on continuation/fragmented frames
- validate text frames as UTF-8 and close with `1007` on invalid data

### 5. Protocol ping handling is incomplete

Files:

- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`

Current behavior:

- application-level JSON `{ type: 'ping' }` gets JSON `{ type: 'pong' }`
- protocol-level incoming pong (`opcode 0xA`) is handled
- protocol-level incoming ping (`opcode 0x9`) is not handled

Impact:

- a standards-compliant client sending a real WebSocket ping will not get a protocol pong
- some clients and intermediaries rely on protocol ping/pong, not app-level JSON ping

Recommendation:

- respond to protocol ping frames with protocol pong frames carrying the same payload
- keep app-level ping only if needed for product semantics

### 6. Close handling is minimal and not standards-oriented

Files:

- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`

Current behavior:

- close frames are answered with an empty close frame
- close code and reason are not parsed or echoed
- protocol violations usually do not produce a close code

Impact:

- harder client debugging
- weaker protocol compliance

Recommendation:

- parse close payloads
- echo close frames where appropriate
- use close codes such as `1002`, `1007`, and `1009` for protocol/data violations

### 7. Extension negotiation is effectively unsupported but not explicit

Files:

- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`

Browsers commonly offer `permessage-deflate`.

Current behavior:

- server does not negotiate extensions
- server also does not document that extensions are intentionally unsupported
- frame parser does not validate RSV bits to ensure no extension semantics leaked in

Recommendation:

- explicitly keep extensions disabled for now
- validate RSV bits and close on unexpected extension use
- document no-extension support until deliberate negotiation is implemented

### 8. Browser auth approach works, but has operational tradeoffs

Files:

- `packages/api/src/websocket.ts`
- `packages/api/src/client-websocket.ts`

Current behavior:

- token is passed in the query string and copied to `Authorization`

Tradeoffs:

- easier browser compatibility
- token can leak into logs, proxies, and browser tooling

Recommendation:

- keep only for local/dev or short-lived tokens
- prefer cookie/session auth or short-lived signed WS tokens in production
- avoid logging raw query strings or full URLs containing secrets

## Likely Root Cause Of The Current Browser Failure

The exact browser handshake failure is still unresolved, but the most important engineering conclusion is this:

- the custom implementation is not yet proven browser-interoperable
- current tests are too synthetic to catch the failure
- the fastest path to reliability is either:
  - migrate the upgrade/frame layer to `ws`, or
  - keep the custom server but validate it against real browser tests plus Autobahn

Given the observed symptom (`Incorrect 'Sec-WebSocket-Accept' header value`) and the fact that raw ad hoc checks looked superficially correct, the remaining problem is likely in the custom handshake path or HTTP upgrade handling rather than in React/frontend code.

## Recommended Next Steps

1. Add a Playwright test that opens `ws://127.0.0.1:3000/v1/ws?...` and asserts the socket reaches `OPEN`.
2. Add a `ws` client integration test that performs a real handshake against the running server.
3. Update `gateway.ts` to accept and forward the `head` buffer.
4. Harden frame validation in `ws-utils.ts` and close invalid connections with proper close codes.
5. Implement protocol ping handling.
6. Decide whether to keep investing in the custom stack or replace the low-level handshake/frame code with `ws`.

## Practical Recommendation

For a product platform, the low-level WebSocket protocol layer is not a good place to carry custom complexity unless there is a very strong reason. The project-specific value is in auth, routing, streaming envelopes, rate limits, and agent integration, not in maintaining an RFC 6455 parser by hand.

The safest approach is:

- use a battle-tested WebSocket implementation for the transport layer
- keep Nexora-specific behavior in message handling, auth, rate limits, and orchestration
