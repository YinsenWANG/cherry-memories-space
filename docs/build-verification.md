# Clean-clone build verification: macOS arm64

Verified on 2026-11-10 against commit `4727e8909de91bf4e58db267eb5be89700fb068d`.

## Environment

- macOS 27.2 (26B123), arm64.
- `node -v`: `v24.18.1` (matches `.nvmrc`; `engines.node` is `>=24.12.0`).
- `pnpm -v`: `12.6.0` (Corepack, matching `packageManager`).
- `python3 -V`: `Python 3.9.6`.
- Fresh shallow clone and fresh `node_modules`; the existing pnpm content-addressable cache was reused, so this does not verify an empty package cache.

## Command log

| Command | Result | Wall time |
| --- | --- | --- |
| `git clone --depth 1 https://github.com/YinsenWANG/cherry-memories-space.git /Users/cherryai001/projects/build-cherry-memories-space` | Success | Not measured |
| `pnpm install --frozen-lockfile` | Exit 0 | 29 seconds |
| `pnpm build:mac:arm64` | Exit 0 | 352 seconds |
| `pnpm exec vitest run src/main/data/db/seeding/__tests__/sharedMemoriesSeeder.test.ts src/main/ai/mcp/servers/__tests__/memory.test.ts src/main/ai/mcp/servers/__tests__/agentMemory.test.ts src/renderer/pages/settings/__tests__/SpaceSettings.test.tsx` | Exit 0; 4 files, 21 tests passed | 12 seconds |

The build script ran type checks, Electron/Vite builds, the memories build, native compilation, and electron-builder. It emitted Vite route and browser-compatibility warnings and linker search-path warnings, but completed successfully. The smoke tests ran while electron-builder was downloading bundled binaries, before its native dependency rebuild.

## Artifacts

Paths are relative to the clone; byte sizes are from `stat -f '%z %N'` after the build finished.

- `dist/Cherry-Studio-2.1.10-mac-arm64.dmg`: 307262823 bytes.
- `dist/Cherry-Studio-2.1.10-mac-arm64.zip`: 307059581 bytes.
- `dist/mac-arm64/Cherry Studio.app/Contents/MacOS/Cherry Studio` exists, has execute permission, and `file` identifies it as a Mach-O 64-bit arm64 executable.

## Not verified

The application was not launched or exercised through its GUI, and the DMG and ZIP were not installed or opened. `codesign -dv` reports an ad hoc signature and no team identifier; Developer ID signing, notarization, and Gatekeeper acceptance were not verified. The targeted tests do not establish end-to-end shared-memory functionality or cover the full suite.

## Local launch smoke test (maintainer, 2026-11-10 10:19 CST)

After the build above, the packaged app was launched once from
`dist/mac-arm64/Cherry Studio.app` (`open`) and observed for ~12 s:

- 6 processes came up (main process + GPU/renderer/utility helpers), main PID alive, no crash loop.
- The app was then terminated; 0 residual processes remained.
- Note: this build shares the default Electron user-data directory
  (`~/Library/Application Support/CherryStudio`) with an installed Cherry Studio.
  When trying a build side by side, point it at a separate user-data directory to avoid
  sharing settings and local databases.

Still not verified: installing from the DMG/ZIP, notarization/Gatekeeper, and end-to-end
shared-memory behaviour in the GUI.
