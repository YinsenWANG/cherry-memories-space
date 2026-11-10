# Phase 2 verification — 2026-11-09

## Real model sessions

Two independent Codex CLI 0.162.1 processes used `gpt-6.1-terra`, a fresh SiYuan 3.8.9 workspace under `/tmp/cherry-memories-phase2-model`, and the same authenticated Streamable HTTP MCP endpoint. The A and B working directories were different and each contained the same [session instructions](verification-phase2/session-instructions.md), copied **before** this phase updated the guide. B's conflict and forget turns resumed B's thread; they did not resume A. These are real model responses, not simulated MCP clients.

The complete ordered JSONL event streams, stderr, and independent database reads are in [verification-phase2/](verification-phase2/). They contain test data, not the temporary token or access code. Codex also logged an unrelated Notion MCP authentication error on stderr; the `memories` server was the SiYuan server and the successful calls below were made to it.

- **Initial A attempt:** MCP tool calls were refused because the test used `approval_policy="never"` without approving that server's tools. A explicitly said the preference was not saved. See [session-a.jsonl](verification-phase2/session-a.jsonl).
- **A retry:** the test allowed tools on this isolated test server and asked A to remember that the team's primary color must never be purple. Sequence: `database.search → document.search_docs → search.fulltext → database.render → database.keys → document.get → database.item_add` (rejected by SiYuan: missing block ID) `→ database.item_add → database.render → database.item_add(detached) → database.render`. The final detached row contained the preference, but **Type and Source Agent were empty**; the preceding second add also left an unintended row referring to the Memories document. `document.get` returned the root without the guide's body, so A did not actually read the full guide. This step **did not fully pass**. See [A retry](verification-phase2/session-a-approved.jsonl) and [independent database read](verification-phase2/database-after-a.jsonl).
- **B recall:** in a fresh process B was asked for a team brand-color recommendation without being told the preference. Sequence: `search.fulltext ×3 → skill.list → skill.load → document.get → database.search → block.get_kramdown → database.render`. B read the full guide with `block.get_kramdown`, rendered the database after full-text search missed the row, recommended blue and explicitly cited the no-purple preference. See [B recall](verification-phase2/session-b-recall.jsonl).
- **B conflict:** asked to replace the old rule with a formal decision to use purple, B ran `database.render → database.item_update → database.render ×2`, updated the same preference row, and stated that the old rule was superseded. See [B conflict](verification-phase2/session-b-conflict.jsonl).
- **B forget:** B ran `search.fulltext ×2 → database.render → repo.search → database.item_remove → search.fulltext → database.render → search.fulltext → sync.status`. It reported the row removed and clearly said it could not verify old snapshots or backups. An independent client then queried the database for both `品牌` and `紫色` and got zero matching rows; full-text search for `紫色` returned no results. See [B forget](verification-phase2/session-b-forget.jsonl) and [independent post-delete reads](verification-phase2/database-after-forget.jsonl). **Whether copies in SiYuan history or backups were erased was not verified.**

The guide and built-in assistant instructions were subsequently amended to name `block.get_kramdown` and the metadata fields. In one additional fresh model process using the [revised instructions](verification-phase2/session-instructions-revised.md) and a different isolated workspace, A read the guide with `block.get_kramdown`, added one detached row, set `Type = Preference`, `Source Agent = Codex Agent A`, Date and Status, and rendered it. An independent read confirmed the row, then the test harness removed it. See [revised A output](verification-phase2/session-a-revised.jsonl) and [independent read and cleanup](verification-phase2/database-revised-and-cleanup.jsonl). This is one successful retry, not a guarantee of model compliance; the original A/B results above remain unchanged.

### Reproducing the model test

Use a disposable workspace and an independently installed SiYuan kernel. The following uses a temporary token from the workspace configuration, passed in an environment variable, not in the prompt or command-line configuration. `--sandbox read-only` limits shell access; the explicit server policy permits MCP calls to the disposable workspace. Never point this experiment at a workspace whose contents you do not intend to modify.

```sh
MEMORIES_HOME=/tmp/cherry-memories-phase2-model \
SIYUAN_KERNEL=/path/to/SiYuan-Kernel node scripts/memories/start.mjs
mkdir -p /tmp/cherry-model-a /tmp/cherry-model-b
cp docs/verification-phase2/session-instructions.md /tmp/cherry-model-a/AGENTS.md
cp docs/verification-phase2/session-instructions.md /tmp/cherry-model-b/AGENTS.md
export SIYUAN_TEST_TOKEN="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/cherry-memories-phase2-model/workspace/conf/conf.json", "utf8")).api.token)')"
codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only -m gpt-6.1-terra \
  -c 'approval_policy="never"' -c 'mcp_servers.memories.url="http://127.0.0.1:16807/mcp"' \
  -c 'mcp_servers.memories.bearer_token_env_var="SIYUAN_TEST_TOKEN"' \
  -c 'mcp_servers.memories.default_tools_approval_mode="approve"' \
  -C /tmp/cherry-model-a --json '你是 Codex Agent A。我们团队的品牌主色永远不用紫色。请记住这个长期团队偏好。'
```

Run a second `codex exec` with the same options and `-C /tmp/cherry-model-b`, asking `你是 Codex Agent B。我要为我们的团队发布一套新的品牌视觉规范，请推荐主色并解释理由。` Save its `thread.started` ID, then use `codex exec … --json resume <thread-id> '<prompt>'` for the conflict and forget prompts in the corresponding event streams. Results can vary between model runs.

## Electron and sidecar

On macOS arm64, an isolated Electron development profile with an installed test SiYuan kernel was started using the repository's debug workflow. A read-only SQLite inspection showed the seeded `@cherry/shared-memories` server was active and trusted, bound to Cherry Assistant, and had the generated local API token. In the UI, Space opened and reported connected. After configuring a second isolated SiYuan endpoint in Settings → Space, the connection test succeeded; after restarting Cherry, the Space editor link pointed to that endpoint. Switching back to local and restarting yielded a connected status without clicking the test button. The test profile had no model configured, so an actual **Cherry Assistant model conversation was not run**.

A fresh source-side sidecar start initialized the workspace automatically; `curl http://127.0.0.1:16808/status` returned `{"ready":true,"reason":""}`, and a same-origin repeat `POST /init` returned `{"ok":true}`. With no discoverable SiYuan binary and an isolated `PATH`, the same status returned `{"ready":false,"reason":"missing_kernel"}` and the Space page included the download link. The local GUI still requires the access code stored in the Space data directory.

The isolated Electron run used the following debug command after the repository's normal debug preparation; the debug port was changed because 9222 belonged to another process. In the opened window, the verification navigated through Launchpad → Mini Apps → Space and Settings → Space, and read the isolated SQLite database without printing credentials.

```sh
CS_DEV_PROFILE_ROOT=/tmp/cherry-memories-phase2-electron \
SIYUAN_KERNEL=/tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel \
pnpm exec dotenv -- electron-vite -- --inspect=9230 --sourcemap --remote-debugging-port=9223
curl -fsS http://127.0.0.1:16808/status
# {"ready":true,"reason":""}
```

A real two-machine, network-disconnected, multi-member or enterprise-permission test has not been run. The remote test used two local kernel processes on different ports; it proves endpoint selection and authentication, not cloud synchronization or member isolation.

## macOS arm64 package size

Both builds used Node 24.22.0, pnpm 12.6.0, the same macOS arm64 host and `CSC_IDENTITY_AUTO_DISCOVERY=false`; they are local measurement artifacts, not notarized distribution releases. The upstream baseline was a detached worktree at `578dcc183632de98b9b4165155112c4f9298663c`, before all Memories commits. The phase 2 build used this working tree.

```sh
CI=1 pnpm install --frozen-lockfile
CI=1 pnpm build
CI=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg --arm64
stat -f '%z bytes %N' 'dist/Cherry-Studio-2.1.10-mac-arm64.dmg'
```

| Artifact | Upstream | Phase 2 | Difference |
| --- | ---: | ---: | ---: |
| arm64 DMG | 300,557,662 B (286.63 MiB) | 300,832,892 B (286.90 MiB) | **+275,230 B (+0.26 MiB)** |
| Sum of file sizes under production `out/` | 152,560,643 B | 152,602,493 B | +41,850 B |

The phase 2 DMG SHA-256 is `0fd1a753907db2f9b8a53684b26bc83f3a83621c464a9780e0fcd6fb48d626df`; the upstream DMG SHA-256 is `fbc61d210dff2c15005db9bf2a7c013050f67a45bb2b0f99695432367ce3d3cb`. This difference includes normal build/compression variation and the Space implementation, scripts, guide, locale catalogs, and sidecar copy of the already-used i18next library. No SiYuan binary is included. The on-disk Space resources occupy 552 KiB; their compressed contribution is not separately isolated from other build changes.

To check packaged resource resolution without touching a real user's Cherry profile, the packaged app executable was run as Electron's Node runtime with `MEMORIES_HOME` pointing to a temporary directory, `MEMORIES_MODULE_ROOT` pointing to the packaged `app.asar`, and the packaged scripts, locale directory and i18next file supplied through the same environment variables as `SpaceService`. With a separately installed test kernel, it automatically initialized a new workspace; `/status` returned `{"ready":true,"reason":""}`, the Chinese Space page and `/setup` loaded, and the initializer resolved the MCP SDK from the packaged app. A repeated same-origin `/init` returned 200 and preserved a test custom Type option. This exercised the **packaged sidecar**, not the full installed GUI or a Cherry model conversation.

```sh
SPACE_APP_ROOT="$PWD/dist/mac-arm64/Cherry Studio.app/Contents"
ELECTRON_RUN_AS_NODE=1 MEMORIES_HOME=/tmp/cherry-memories-phase2-packaged \
SIYUAN_KERNEL=/tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel \
MEMORIES_MODULE_ROOT="$SPACE_APP_ROOT/Resources/app.asar" \
MEMORIES_I18NEXT_FILE="$SPACE_APP_ROOT/Resources/memories/i18next.cjs" \
MEMORIES_LOCALES_DIR="$SPACE_APP_ROOT/Resources/memories/locales" MEMORIES_LANGUAGE=zh-CN \
"$SPACE_APP_ROOT/MacOS/Cherry Studio" "$SPACE_APP_ROOT/Resources/memories/scripts/memories/start.mjs"
# In another terminal:
curl -fsS http://127.0.0.1:16808/status
# {"ready":true,"reason":""}
curl -fsS -X POST -H 'Origin: http://127.0.0.1:16808' http://127.0.0.1:16808/init
# {"ok":true}
```

The custom-option check used an independent MCP client to search the `Memories` database, read its `Type` options, append `UserCustom` via `database.key_update`, repeat `/init`, and read the options again. Its observed output was `repeat initialization: 200 {"ok":true}` and `custom option preserved: true`.


## Focused checks

- `pnpm test:main src/main/data/db/seeding/__tests__/sharedMemoriesSeeder.test.ts src/main/data/db/seeding/__tests__/SeedRunner.test.ts src/main/data/db/seeding/seeders/__tests__/miniAppSeeder.test.ts` — 3 files, 24 tests passed.
- `pnpm test:renderer src/renderer/pages/settings/__tests__/SpaceSettings.test.tsx` — 1 test passed; it catches sending a local token when switching to a remote backend.
- `pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts src/shared/data/presets/__tests__/builtinMiniAppCatalog.test.ts` — 2 files, 6 tests passed.
- `pnpm i18n:check`, `pnpm docs:check`, `pnpm build:builtin-knowledge:check`, changed-file Oxlint, ESLint and formatting checks passed. `pnpm build` passed its type checks and production build.

## Changed files and line counts

Counts are against phase 1 `origin/main`; JSONL counts are event lines, and the locale catalogs contain translated copies of the new UI strings.

| File | Added | Removed |
| --- | ---: | ---: |
| `README.md` | 17 | 15 |
| `docs/architecture.md` | 11 | 7 |
| `docs/chatgpt-space.md` | 18 | 0 |
| `docs/custom-instructions.md` | 2 | 2 |
| `docs/memories-agent-guide.md` | 2 | 2 |
| `docs/verification-phase2.md` | 177 | 0 |
| `docs/verification-phase2/database-after-a.jsonl` | 3 | 0 |
| `docs/verification-phase2/database-after-forget.jsonl` | 3 | 0 |
| `docs/verification-phase2/database-revised-and-cleanup.jsonl` | 3 | 0 |
| `docs/verification-phase2/session-a-approved.jsonl` | 27 | 0 |
| `docs/verification-phase2/session-a-approved.stderr` | 2 | 0 |
| `docs/verification-phase2/session-a-revised.jsonl` | 36 | 0 |
| `docs/verification-phase2/session-a-revised.stderr` | 2 | 0 |
| `docs/verification-phase2/session-a.jsonl` | 13 | 0 |
| `docs/verification-phase2/session-a.stderr` | 2 | 0 |
| `docs/verification-phase2/session-b-conflict.jsonl` | 13 | 0 |
| `docs/verification-phase2/session-b-conflict.stderr` | 2 | 0 |
| `docs/verification-phase2/session-b-forget.jsonl` | 23 | 0 |
| `docs/verification-phase2/session-b-forget.stderr` | 1 | 0 |
| `docs/verification-phase2/session-b-recall.jsonl` | 24 | 0 |
| `docs/verification-phase2/session-b-recall.stderr` | 2 | 0 |
| `docs/verification-phase2/session-instructions-revised.md` | 5 | 0 |
| `docs/verification-phase2/session-instructions.md` | 5 | 0 |
| `electron-builder.yml` | 10 | 0 |
| `resources/builtin-agents/cherry-assistant/agent-template.json` | 2 | 2 |
| `resources/builtin-agents/cherry-assistant/agent.json` | 2 | 2 |
| `resources/builtin-agents/cherry-assistant/product-manifest.json` | 1 | 0 |
| `scripts/memories/bootstrap.mjs` | 11 | 4 |
| `scripts/memories/server.mjs` | 56 | 10 |
| `scripts/memories/start.mjs` | 121 | 86 |
| `src/main/core/application/serviceRegistry.ts` | 2 | 0 |
| `src/main/core/paths/pathRegistry.ts` | 16 | 0 |
| `src/main/data/db/seeding/__tests__/sharedMemoriesSeeder.test.ts` | 56 | 0 |
| `src/main/data/db/seeding/seederRegistry.ts` | 3 | 1 |
| `src/main/data/db/seeding/seeders/sharedMemoriesSeeder.ts` | 44 | 0 |
| `src/main/i18n/locales/de-de.json` | 17 | 0 |
| `src/main/i18n/locales/el-gr.json` | 17 | 0 |
| `src/main/i18n/locales/en-us.json` | 17 | 0 |
| `src/main/i18n/locales/es-es.json` | 17 | 0 |
| `src/main/i18n/locales/fr-fr.json` | 17 | 0 |
| `src/main/i18n/locales/it-it.json` | 17 | 0 |
| `src/main/i18n/locales/ja-jp.json` | 17 | 0 |
| `src/main/i18n/locales/pt-pt.json` | 17 | 0 |
| `src/main/i18n/locales/ro-ro.json` | 17 | 0 |
| `src/main/i18n/locales/ru-ru.json` | 17 | 0 |
| `src/main/i18n/locales/th-th.json` | 17 | 0 |
| `src/main/i18n/locales/tr-tr.json` | 17 | 0 |
| `src/main/i18n/locales/vi-vn.json` | 17 | 0 |
| `src/main/i18n/locales/zh-cn.json` | 17 | 0 |
| `src/main/i18n/locales/zh-tw.json` | 17 | 0 |
| `src/main/services/SpaceService.ts` | 96 | 0 |
| `src/renderer/components/settingsMenu.ts` | 7 | 0 |
| `src/renderer/i18n/locales/de-de.json` | 5 | 0 |
| `src/renderer/i18n/locales/el-gr.json` | 5 | 0 |
| `src/renderer/i18n/locales/en-us.json` | 5 | 0 |
| `src/renderer/i18n/locales/es-es.json` | 5 | 0 |
| `src/renderer/i18n/locales/fr-fr.json` | 5 | 0 |
| `src/renderer/i18n/locales/it-it.json` | 5 | 0 |
| `src/renderer/i18n/locales/ja-jp.json` | 5 | 0 |
| `src/renderer/i18n/locales/pt-pt.json` | 5 | 0 |
| `src/renderer/i18n/locales/ro-ro.json` | 5 | 0 |
| `src/renderer/i18n/locales/ru-ru.json` | 5 | 0 |
| `src/renderer/i18n/locales/th-th.json` | 5 | 0 |
| `src/renderer/i18n/locales/tr-tr.json` | 5 | 0 |
| `src/renderer/i18n/locales/vi-vn.json` | 5 | 0 |
| `src/renderer/i18n/locales/zh-cn.json` | 5 | 0 |
| `src/renderer/i18n/locales/zh-tw.json` | 5 | 0 |
| `src/renderer/pages/settings/SpaceSettings.tsx` | 182 | 0 |
| `src/renderer/pages/settings/__tests__/SpaceSettings.test.tsx` | 77 | 0 |
| `src/renderer/routeTree.gen.ts` | 21 | 0 |
| `src/renderer/routes/settings/space.tsx` | 5 | 0 |
| `src/shared/data/presets/miniApps.ts` | 2 | 1 |
