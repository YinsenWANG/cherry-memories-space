# Verification report — 2026-11-09

All examples used temporary directories under `/tmp`, not the user's existing Cherry or SiYuan workspace. The tested upstream Cherry commit was `578dcc183632de98b9b4165155112c4f9298663c`; macOS arm64, SiYuan 3.8.9, Node 24.22.0, pnpm 12.6.0. The initial attempt with Node 22 failed when Corepack's pnpm download terminated; upstream currently requires Node >=24.12 and pins pnpm 12.6.0. Retrying with installed Node 24 succeeded.

## Install and build

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH CI=1 pnpm install --frozen-lockfile
# Done in 51.2s using pnpm v12.6.0
PATH=/opt/homebrew/opt/node@24/bin:$PATH CI=1 /usr/bin/time -p pnpm build
# real 37.54
# user 110.68
# sys 16.59
# exit 0; out/ is 157 MiB (build output, not an installer)
```

The modified Cherry source passed the full upstream `pnpm build`, including type checks, renderer/main/preload and utility-process builds. No Electron installer was built, so an installer-size delta is **not measured**. The external SiYuan 3.8.9 macOS arm64 DMG downloaded as 279,981,928 bytes, with SHA-256 matching the upstream checksum; nothing from that DMG is added to the repository or installer.

```sh
pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts src/shared/data/presets/__tests__/builtinMiniAppCatalog.test.ts
# 2 test files passed, 6 tests passed
pnpm test:main src/main/data/db/seeding/seeders/__tests__/miniAppSeeder.test.ts
# 1 test file passed, 10 tests passed
pnpm exec oxfmt --check scripts/memories/*.mjs src/renderer/i18n/label.ts src/shared/data/presets/mcpServers.ts src/shared/data/presets/miniApps.ts src/shared/utils/mcp.ts
# All matched files use the correct format.
pnpm exec oxlint --deny-warnings scripts/memories/*.mjs src/renderer/i18n/label.ts src/shared/data/presets/mcpServers.ts src/shared/data/presets/miniApps.ts src/shared/utils/mcp.ts
# exit 0
```

## Fresh startup and idempotent setup

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH \\
  MEMORIES_HOME=/tmp/cherry-memories-fresh2 \\
  SIYUAN_KERNEL=/tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel \\
  node scripts/memories/start.mjs
# kernel booted, HTTP server 127.0.0.1:16807
# Memories UI: http://127.0.0.1:16808/
curl -fsS http://127.0.0.1:16808/status
# {"ready":true}
curl -fsS -X POST -H 'Origin: http://127.0.0.1:16808' http://127.0.0.1:16808/init
# {"ok":true}
# Same POST a second time: {"ok":true}
```

The first implementation exposed a genuine fresh-workspace race: SiYuan returned `indexUnavailable` immediately after creating the notebook. The initializer now retries only that explicit pre-creation error; a new clean workspace succeeded on its first and second button requests. Native MCP inspection found exactly one `Cherry-Studio-Memories` notebook and one matching `Memories` attribute-view database; its Type and Status columns contain the expected options. The workspace contains `Agent Operating Guide`, `About` and `Skills` documents. After the Skill initializer was added, two more successful runs left a native `data/storage/ai/agent/skills/cherry-studio-memories/SKILL.md` in the test workspace.

## Two MCP clients, correction, GUI edit and removal

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH \\
  SIYUAN_WORKSPACE=/tmp/cherry-memories-fresh2/workspace node scripts/memories/smoke.mjs
# A wrote: 品牌主色不用紫色 70bd99c1
# B recalled A and its source
# B corrected: 品牌主色改为蓝色，不用紫色 70bd99c1
# B removed the row; matching rows: 0
```

This is a reproducible **two independent MCP client session** test, not two LLM conversations. A closes before B connects; B searches the same database, verifies the source field, edits the same row, removes it, and checks the database search no longer returns that unique marker. A separate earlier GUI test created `品牌主色不用紫色`, retrieved and corrected it via MCP, signed in to the SiYuan browser GUI, opened the native Memories table, double-clicked the same row and changed it to `品牌主色以蓝色为主，不用紫色`; a fresh MCP session read that GUI edit and removed the row. Database removal is **not** proof that SiYuan history, backups or remote copies have been erased.

## Cherry and setup UI

A built Electron app was launched with `CS_DEV_PROFILE_ROOT=/tmp/cherry-memories-app-profile`; no model/provider was connected. Via its UI: Launchpad → 小程序 → Memories opened a Cherry webview at `http://127.0.0.1:16808/` and displayed a connected backend and the setup prompt. In the isolated Cherry profile, the MCP catalog preset was manually added, supplied with the temporary workspace token, and enabled: its settings showed `已连接`, server version `3.8.9`, and `工具 (31)`. A trusted mouse click on the copy button in the Electron webview wrote the exact `http://127.0.0.1:16808/setup` prompt to the system clipboard, confirmed with `pbpaste`; the initial `navigator.clipboard` implementation failed in Electron and was fixed with a user-gesture copy fallback. In a separate Chrome/Playwright session, the initialize button completed and the local setup URL returned HTTP 200. An invalid cross-origin POST to `/init` returned HTTP 403. The SiYuan GUI test above used a separate temporary workspace and test access code.

## Not yet verified / missing

- The MCP preset is **not auto-installed, auto-configured or automatically bound** to Cherry's built-in agent. The user must add it, enter the SiYuan token, enable it and bind it in the agent editor. The configured preset connected and listed 31 tools in Cherry; binding it to an agent and invoking the tools through a model were not exercised.
- No real model-backed Agent A/B ran. We did not verify that a model follows the guide, decides what to save, uses a recalled preference in an answer, resolves a conflict, or carries out a complete forget request across all copies.
- The native Skills index and example SKILL.md exist, but Notion's per-surface enabled list, full skill package migration, conflict prevention and automatic reimport exclusions are not reproduced.
- The sidecar is a source-checkout process requiring Node and SiYuan. Binary detection and a download link are provided; there is no bundled installer or automatic download. Linux/Windows startup and GUI were not tested. Remote access requires a separate secure deployment.
- Actual full Notion Memories schema/source-agent property remains unverified without an authorized Notion workspace. Installer size, backup/history purge, concurrent writers, and hardened multi-user isolation have not been tested.

The commits are GPG-signed and verify locally. GitHub reported the pushed commit signature as `verified: false`, reason `no_user`; the signing key email is not currently associated with a verified GitHub account. GitHub account/key verification is outside this checkout.
