# Remote Access Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Other computers on the network need an access key to control Split Control or read its live data. The app itself and outputs on this computer don't.

**Decisions (operator, 2026-11-21):**
- The key is required by default. A Settings switch turns the requirement off. Existing Stream Deck setups stop working until the key is entered in Companion.
- Remote output pages (OBS/vMix on another computer) need the key too. It can be passed in the URL (`?key=`), so a copied link just works.

**Architecture:**
- **Key check:** `src/main/security/accessKey.ts` holds the rules: what counts as a local address, where a request's key is read from, and a constant-time comparison.
- **HTTP:** an Express middleware guards the remote routes.
- **Socket.IO:** a middleware on both namespaces guards the WebSocket.
- **Config:** `remoteAccess: { requireKey, key }`. A key is generated on first start and saved.
- **Changes in Settings:** turning the requirement on or making a new key disconnects remote sockets that no longer qualify.

## Global Constraints

- **Local requests** (127.0.0.0/8, ::1, ::ffff:127.x) never need the key. These are the app's windows, previews, NDI capture, and OBS on this computer.
- **Where the key is read from**, in this order:
  - HTTP: `Authorization: Bearer <key>`, then `X-Split-Key`, then `?key=`;
  - Socket.IO: `handshake.auth.key`, then `handshake.query.key`.
- **Protected HTTP paths:** `/api/control`, `/ograf/v1`, `/api/director`, `/director`, `/output`, `/output/:id`, `/preview`, `/api/output/info`, `/api/graphics`.
- **Open HTTP paths:** `/health`, `/docs`, and the static look files and assets. These carry no event data.
- **Refusal:**
  - APIs get 401 with JSON `{ ok: false, success: false, error: 'Access key required…' }`;
  - pages get 401 with a short HTML explanation.
- **Key format:** 24 characters of base64url (18 random bytes).
- **Logging:** never log a key. The dev redirect log of the output URL removes `key`.

## Tasks

### Task 1: Key rules and config
- **Create:** `src/main/security/accessKey.ts`:
  - `generateAccessKey()`;
  - `isLocalAddress(addr)`;
  - `keyFromHttp(req)`;
  - `keyMatches(given, expected)`;
  - `remoteAllowed({ address, key }, settings)`;
  - `cleanRemoteAccess(raw)`, which generates a key if it is missing or invalid.
- **Config:**
  - add the `remoteAccess` field and clean it in `mergeConfig`;
  - when `loadConfig` had to create the key, save it;
  - `settings:update` keeps `remoteAccess`.
- **Tests:**
  - local addresses;
  - the key from the header, the bearer token and the query;
  - a wrong, empty or differently sized key is refused;
  - nothing is refused when `requireKey` is false;
  - config cleaning.

### Task 2: HTTP and socket guards
- **HTTP:** `requireAccessKey(getSettings)` Express middleware, mounted on the protected paths in WebServer.
- **Socket.IO:** `socketAccessGuard(getSettings)` middleware on `/` and `/control`.
- **Disconnecting:** `WebSocketServer.dropUnauthorised()` disconnects remote sockets that no longer qualify.
- **Logging:** remove the key from the dev redirect log.
- **Tests:**
  - middleware: 401 for a remote request without the key, a pass for local requests and for the right key, an HTML page for page routes;
  - socket guard: refusal and pass cases.

### Task 3: Clients send the key
- **Web output page:** read `key` from its URL and pass it as socket `auth`.
- **Director page:** read `key` from its URL and send it as the `X-Split-Key` header on fetches.
- **Companion:**
  - a password field `key` ("Access key"), sent as `Authorization: Bearer` on HTTP and as socket `auth`;
  - extend its test.
- **IPC `output:getWebInfo`:** network URLs get `?key=` while the key is required. The localhost URL stays without it.

### Task 4: Settings → Remote access
- **IPC:**
  - `remoteAccess:get` returns `{ requireKey, key }`;
  - `remoteAccess:set({ requireKey })`;
  - `remoteAccess:regenerate`.
  - The last two save, then call `dropUnauthorised`.
- **UI:**
  - the switch;
  - the key, hidden until revealed, with Copy and Make a new key (with a confirmation);
  - a note on what needs it (Companion, OBS/vMix on another computer, the director page, OGraf controllers);
  - translations.
- **Docs:** update the Companion setup notes.

### Task 5: Check in the real app
- From this computer: the output and control API work without the key.
- As if remote (bound to the machine's network address): the API answers 401, works with the key in the header and with `?key=`, and the socket is refused without the key.
- Making a new key disconnects a remote socket that used the old one.
