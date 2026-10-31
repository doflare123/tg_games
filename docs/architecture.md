# Architecture decisions

## Runtime boundaries

This repository is the separate games bot. The existing Armaturina host is not a dependency. Client games execute in Telegram WebView; serverless endpoints manage authoritative state and rankings. Source code is TypeScript; generated cloud modules are JavaScript as required by the platform.

- `games/tetris`: deterministic simulation with integer tick input. No DOM, Node or platform SDK.
- `shared`: versioned contracts, runtime validation and errors.
- `server/domain`: use cases; depends on an explicit repository port and injectable clock/seed source.
- `server/platform`: SQLite implementation and narrow SDK declarations based on the installed CLI documentation.
- `server/endpoints`: authentication boundary, input validation through domain methods and platform error mapping.
- `client/platform`: Telegram transport and browser persistence.
- `client/games`: lifecycle, controls, rendering and save adapters, loaded on demand.

An extra cloud TypeScript configuration excludes both DOM and Node libraries. The build rejects Node/Bun imports and unbundled third-party cloud runtime imports. It emits shared cloud chunks inside `tgcloud/lib`, where the platform can import them.

## Ranked Tetris

A run has an owner, ruleset, server-selected seed, mode, creation deadline and revision. Client actions are indexed by simulation tick. At most 600 ticks and four actions per tick are processed per submission. The endpoint reproduces the simulation from the last server checkpoint and derives score, lines and completion itself.

A SQL conditional update on the previous revision arbitrates concurrent writes. The accepted input receipt is stored in the same row as the new checkpoint. Before a later checkpoint replaces that receipt, it is archived in `replay_chunks`. The newest receipt remains in `runs`, so an interrupted archive cannot lose accepted input. Exact retries of the most recent accepted submission return the existing state. Older/out-of-order submissions return a conflict.

There is no persistent background worker requirement for Tetris: bounded verification happens during submission. No external queue or Redis is needed. Server time limits obvious accelerated uploads; replay verification still does not prove absence of automation or TAS.

The leaderboard queries verified runs only, selects the best run per user and applies stable ties. Sprint sorts by ticks, then score; score modes sort by score, then ticks. Earlier start and run id break remaining ties. The period is determined by the server-side start time. Weekly boundaries use Monday UTC. The caller’s own position is returned even outside top-50.

## Game integrations

NES and Doom run in ordinary practice mode. Their save states do not become verified runs. NES saves are keyed by ROM SHA-256. Doom runs in a disposable same-origin iframe, and only validated messages from that iframe are accepted. Its engine source and compiler are pinned; ROM/IWAD files are supplied locally and never uploaded.

The Doom engine is built with Emscripten and SDL. MIDI instrument patches are not included yet. The iframe uses a native module-script loader so Vite does not try to transform generated engine code. The iframe is removed on disposal to release the WASM heap, event loop and audio context with its document.

## What has been checked

- Strict source and isolated cloud type checks.
- Deterministic game mechanics and checkpoint replay.
- Domain security, idempotency, concurrency and archive behavior against real local SQLite.
- Browser: desktop and narrow viewport, complete ranked Tetris to leaderboard, generated synthetic NES ROM and save restoration, built Doom WASM with Freedoom test data.
- Client/cloud production build; separate browser smoke path for production without a fake authenticated user.

These checks do not establish actual Telegram runtime quotas, migration behavior or mobile WebView compatibility. Those require a linked test bot. Original Mario game data was not supplied; the NES browser test uses a generated non-game program.

## Next gates

1. Link the new test bot through the CLI, deploy and migrate explicitly; test endpoints and update handlers inside Telegram.
2. Measure invocation limits, database capacity and latency at expected concurrency. Exercise SQL RETURNING and window queries on the real platform.
3. Freeze original Mario/Doom content revisions and metric extraction rules. Prove headless replay compatibility before enabling their ranked modes.
4. Group scopes and notifications are implemented; verify the native ephemeral API and membership updates on a live bot. Add seasons, history UI and invalidation tools. See groups-and-controls.md for the membership and notification policy.
5. Define retention/cleanup and backups for abandoned runs and replay archives before public rollout. This first version does not silently delete player records.
6. Add Doom MIDI patches, further touch ergonomics, target-device performance checks and accessibility passes before calling the original-game integrations complete.

## Administrative recovery and lifecycle

Manual corrections are stored in manual_results separately from replay-verified runs, with operator, reason, approximation flag and nullable duration. They participate in the same personal-best/global/group query and atomic result ordering, are labelled manual in the UI, and never create notifications. Unknown durations lose score ties to known durations; Sprint requires known time. The service CLI endpoint refuses Mini App contexts. A correction id is immutable and idempotent.

A completed game awaiting upload is never abandoned by blur/visibility changes. Sync freezes the target tick before awaiting transport, so the upload loop cannot chase new frames indefinitely. Final snapshots are persisted immediately, with per-run backup keys as well as the latest-save key. Live-game pause still ends eligibility and the UI explicitly labels practice mode.

## Group rankings from existing records

Group boards filter the same verified/manual result union by confirmed current group_memberships, independent of each run's historical group_ids_json. Membership discovery checks known connected groups for the caller, and scans known players with finished results in bounded batches (24, concurrency 4). Cached membership rows are the durable progress cursor with a 15-minute freshness window. The UI distinguishes complete, pending and failed synchronization; pending requests resume automatically, failures require a retry. Caller access is always checked afresh. Chat member events update one group without changing global scores.

The immutable group_ids_json field remains the recipient eligibility snapshot for announcements only. Membership synchronization never reprocesses results or creates social jobs. New-result announcements wait for a complete membership baseline and recheck it at delivery.
