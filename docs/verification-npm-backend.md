# npm backend verification

These checks ran on 2026-11-09 on macOS arm64, with Node 24.18.0 for development and Electron 45.2.2 / Node 24.22.2 in the packaged app. The baseline is commit `5b3b1e93888fe352b1d7171981e8b9c8c8c29d07`. Commands below run from the repository root unless stated otherwise. Tests use synthetic accounts and memories.

At the final remote check, `origin/main` had advanced to `2e5e4af` with two SiYuan review commits; its merge base with this branch was still the stated baseline. Those commits were not merged into this branch. Review their relationship to the npm implementation before a future merge.

## Service, isolation and initialization

```sh
node --test packages/cherry-memories-server/test/server.test.mjs
```

```text
✔ REST validates, deduplicates, detects stale writes and forgets; pages and table share the service
✔ MCP HTTP and stdio clients share search, create, update, forget and revision checks
✔ initialization preserves the guide and skill, and creates one Memories table
✔ concurrent writers cannot overwrite the same revision or open a second writer
✔ two accounts have isolated spaces over REST and MCP
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

The tests exercise create, search, update and forget over both REST and MCP; missing Type and SourceAgent, similar active titles, stale revisions and attempts to bypass memory validation through table rows are rejected. A two-row table check verifies filtering and ascending/descending sort. The account test starts the actual server CLI on a random port, registers and signs in two accounts, and checks that the second account receives a 404 when trying the first account's Space over REST and MCP. It also verifies sign-out invalidates the session. The initialization test edits the Guide and Skill, initializes twice and checks that there is still one Memories table, one Guide and one Skill with the edits preserved. Concurrent writes with one revision result in one success and two stale-revision responses.

## Two real model sessions

```sh
node packages/cherry-memories-server/test/model-sessions.mjs .context/cherry-electron-dev/memories-model-replay
```

The script starts an isolated service and runs two separate `codex exec --ephemeral --ignore-user-config --json -m gpt-6.1-terra -s read-only` sessions. The run used Codex CLI 0.162.1. Its MCP configuration explicitly approves the synthetic test server's tools; an earlier attempt with the default approval policy rejected the tool calls. Both sessions exited 0. The completed tool calls were:

```text
A memory_search  query="travel ideas"                -> revision 1, no rows
A memory_create  Type=Preference, SourceAgent=session-a -> revision 2, active
B memory_search  query="travel ideas"                -> revision 2, the preference
B answer         two fictional travel ideas with bold headings
B memory_update  same row, plain headings           -> revision 3
B memory_forget  same row                           -> revision 4, forgotten, Body=""
```

Session A's prompt explicitly specified Type and SourceAgent; session B's prompt explicitly requested search, correction and forgetting in that order. This is one successful sampled run, not evidence that an agent will always follow the discipline unprompted. The JSONL transcripts and stderr are written to the requested output directory. An unrelated preconfigured Notion MCP also logged an authentication-required error in stderr; the Memories calls above succeeded.

## Packaged local app

The final app was built with the regular build, followed by a packaging pass after staging the server dependencies:

```sh
pnpm run build:mac:arm64
pnpm build:memories
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64
```

The acceptance run used a fresh profile, restricted writes to the other worktrees and real Cherry profile with macOS `sandbox-exec`, and set the app's `PATH` to `/usr/bin:/bin`. `--no-sandbox` was necessary to launch Chromium inside that outer test sandbox; the macOS file restrictions remained in force. It did not use an installed Node or npm to launch the app or its local service. For reproduction, use a fresh profile and an unused CDP port:

```sh
mkdir -p .context/cherry-electron-dev/packaged-profile3
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "/Users/cherryai001/projects/Cherry-Studio-Memories"))(deny file-write* (subpath "/Users/cherryai001/projects/cherry-memories-eidos"))(deny file-write* (subpath "/Users/cherryai001/.hermes/hermes-agent"))(deny file-write* (subpath "/Users/cherryai001/.cherrystudio"))(deny file-write* (subpath "/Users/cherryai001/.agents"))(deny file-write* (subpath "/Users/cherryai001/Library/Application Support/CherryStudio"))' \
  /usr/bin/env PATH=/usr/bin:/bin \
  CFFIXED_USER_HOME="$PWD/.context/cherry-electron-dev/packaged-profile3" \
  "$PWD/dist/mac-arm64/Cherry Studio.app/Contents/MacOS/Cherry Studio" \
  --user-data-dir="$PWD/.context/cherry-electron-dev/packaged-profile3/userData" \
  --remote-debugging-port=9228 --inspect=9238 --no-sandbox --lang=zh-CN
```

With that process running, the following test runner uses a development Node and Playwright only as the external client. The main-window URL must match the running packaged instance exactly:

```sh
node packages/cherry-memories-server/test/electron-smoke.mjs \
  'http://127.0.0.1:9228' \
  'file:///Users/cherryai001/projects/cherry-memories-npm/dist/mac-arm64/Cherry%20Studio.app/Contents/Resources/app.asar/out/renderer/windows/main/index.html' \
  "$PWD/.context/cherry-electron-dev/packaged-profile3/userData/Data/Space"
```

```text
page saved; row created and edited; Type filter applied; external HTTP and setup stdio MCP returned the edit
```

The runner creates and saves a page with RichEditor, adds and edits a table row, applies the Type filter, reads the result through external Streamable HTTP MCP, and starts the stdio configuration copied from `/setup` with a PATH without Node/npm. It also checks the persisted page through REST. An earlier packaging attempt omitted nested `node_modules`; the final build includes them and its packaged server source was compared to the checkout.

The packaged settings UI was also checked against a separate local server in remote mode. This uses a second fresh profile and ports 9229/9239 with the same sandbox launch above:

```sh
BETTER_AUTH_SECRET='remote-ui-test-secret-012345678901234567890123456789' \
CHERRY_MEMORIES_ALLOWED_ORIGINS='null' \
node packages/cherry-memories-server/src/cli.mjs --data-dir .context/cherry-electron-dev/remote-ui-server --port 0
# In another shell, with the packaged app running on CDP port 9229:
node packages/cherry-memories-server/test/electron-remote-smoke.mjs \
  'http://127.0.0.1:9229' \
  'file:///Users/cherryai001/projects/cherry-memories-npm/dist/mac-arm64/Cherry%20Studio.app/Contents/Resources/app.asar/out/renderer/windows/main/index.html' \
  'http://127.0.0.1:63912'
```

```text
CHERRY_MEMORIES_READY {"url":"http://127.0.0.1:63912"}
remote UI: alice and bob sign-in, isolated Space rows, and sign-out passed
```

Use the port printed by the server on a new run. The runner registers two fresh synthetic accounts, gives each a distinct memory, signs in and out through the packaged settings UI, and checks that each account sees its own row and not the other's. After sign-out, the previous row is no longer displayed.

## npm package and runtime size

```sh
(cd packages/cherry-memories-server && npm pack --pack-destination ../../.context/cherry-electron-dev/npm-pack-check)
npm install --prefix .context/cherry-electron-dev/npm-pack-check/install-final --offline --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
  "$PWD/.context/cherry-electron-dev/npm-pack-check/cherry-memories-server-0.1.0.tgz"
node packages/cherry-memories-server/test/npm-package-smoke.mjs \
  .context/cherry-electron-dev/npm-pack-check/install-final/node_modules/.bin/cherry-memories-server
node packages/cherry-memories-server/test/npm-package-smoke.mjs \
  /Users/cherryai001/.cherrystudio/bin/bun packages/cherry-memories-server/src/cli.mjs
```

```text
cherry-memories-server@0.1.0: 9 files, 24.3 kB package, 83.7 kB unpacked
added 118 packages in 3s
server CLI: spaces=1, write=201, search=1
server CLI: spaces=1, write=201, search=1
```

The first smoke runs the installed package with Node; the second runs the same CLI with Bun 1.4.2. Substitute the local Bun executable path when reproducing. The offline install uses a populated npm cache. The package tarball includes source, README and AGPL license; it does not include the dependency tree. The repository build uses its lockfile, while installing a published npm package resolves its transitive dependencies at install time.

```sh
stat -f '%N %z bytes' dist/Cherry-Studio-2.1.10-mac-arm64.dmg dist/Cherry-Studio-2.1.10-mac-arm64.zip
shasum -a 256 dist/Cherry-Studio-2.1.10-mac-arm64.dmg
find out/memories/node_modules -type f -exec stat -f '%z' {} + | awk '{s+=$1; n++} END {printf "files=%d bytes=%.0f\n",n,s}'
```

```text
dist/Cherry-Studio-2.1.10-mac-arm64.dmg 307350077 bytes
dist/Cherry-Studio-2.1.10-mac-arm64.zip 307080124 bytes
8b155e3f9fa73625e2c71c5498e7584268c5aae7cbeb6d20d45d280fd1f8aeda  dist/Cherry-Studio-2.1.10-mac-arm64.dmg
files=5536 bytes=32263055
```

The DMG is **6,517,185 B larger** than the supplied SiYuan baseline of 300,832,892 B; the baseline was not rebuilt in this run. The final app includes the server dependency tree, so a local user's first run downloads **0 B of npm tarballs and unpacks 0 B of npm dependencies**. At build time, the earlier npm probe measured 6,700,891 B of registry tarballs and 32,263,020 B of unpacked ordinary files for the same locked versions and integrities; this build's staged tree measured 32,263,055 B including npm metadata. These figures are different from DMG size and exclude network overhead.

## Other checks and limits

```sh
pnpm test:main --maxWorkers=1 src/main/data/db/seeding/seeders/__tests__/miniAppSeeder.test.ts src/main/data/db/seeding/__tests__/sharedMemoriesSeeder.test.ts src/main/ai/agents/__tests__/prompt.test.ts
pnpm exec vitest run --project renderer src/renderer/pages/settings/__tests__/SpaceSettings.test.tsx
pnpm typecheck:node
pnpm typecheck:web
pnpm i18n:check
```

The focused main tests passed 43 tests in 3 files; the settings test passed 1 test. Both typechecks and locale validation passed.

After packaging, direct Node-based database tests initially ended with `SIGKILL`: Electron's rebuild had replaced the local `better-sqlite3` macOS prebuild. `pnpm rebuild:node` alone did not restore it. Restoring `prebuilds/darwin-arm64.node` from the published `better-sqlite3@13.0.3` npm tarball, then running the main test wrapper above, passed. This concerns the development dependency tree; the packaged-app acceptance run above used the built app successfully.

Not verified: packaged Windows or Linux, a remote server behind a real HTTPS reverse proxy, backup/restore, migration of existing SiYuan data, or any guarantee of secure erasure. Registration is enabled and must be restricted by the operator. A server uses one process per data directory; after a crash a stale lock can require manual inspection and removal. The packaged GUI test used a test sandbox and did not test platform code signing or notarization.

## Changed files

The following 60 files differ from the specified baseline:

```text
README.md
docs/architecture-npm-backend.md
docs/architecture.md
docs/chatgpt-space.md
docs/custom-instructions.md
docs/deploy-server.md
docs/dev/README.md
docs/dev/references/ai/agent-prompt-layers.md
docs/dev/references/memory/README.md
docs/dev/references/memory/overview.md
docs/memories-agent-guide.md
docs/setup.md
docs/verification-npm-backend.md
electron-builder.yml
package.json
packages/cherry-memories-server/LICENSE
packages/cherry-memories-server/README.md
packages/cherry-memories-server/package-lock.json
packages/cherry-memories-server/package.json
packages/cherry-memories-server/src/cli.mjs
packages/cherry-memories-server/src/guide.md
packages/cherry-memories-server/src/mcp.mjs
packages/cherry-memories-server/src/server.mjs
packages/cherry-memories-server/src/stdio.mjs
packages/cherry-memories-server/src/store.mjs
packages/cherry-memories-server/test/electron-remote-smoke.mjs
packages/cherry-memories-server/test/electron-smoke.mjs
packages/cherry-memories-server/test/model-sessions.mjs
packages/cherry-memories-server/test/npm-package-smoke.mjs
packages/cherry-memories-server/test/server.test.mjs
pnpm-lock.yaml
scripts/build-memories.mjs
src/main/ai/agents/prompt.ts
src/main/core/paths/pathRegistry.ts
src/main/data/db/seeding/seeders/__tests__/miniAppSeeder.test.ts
src/main/data/db/seeding/seeders/miniAppSeeder.ts
src/main/services/SpaceService.ts
src/renderer/i18n/locales/de-de.json
src/renderer/i18n/locales/el-gr.json
src/renderer/i18n/locales/en-us.json
src/renderer/i18n/locales/es-es.json
src/renderer/i18n/locales/fr-fr.json
src/renderer/i18n/locales/it-it.json
src/renderer/i18n/locales/ja-jp.json
src/renderer/i18n/locales/pt-pt.json
src/renderer/i18n/locales/ro-ro.json
src/renderer/i18n/locales/ru-ru.json
src/renderer/i18n/locales/th-th.json
src/renderer/i18n/locales/tr-tr.json
src/renderer/i18n/locales/vi-vn.json
src/renderer/i18n/locales/zh-cn.json
src/renderer/i18n/locales/zh-tw.json
src/renderer/pages/settings/SpaceSettings.tsx
src/renderer/pages/settings/__tests__/SpaceSettings.test.tsx
src/renderer/pages/space/SpacePage.tsx
src/renderer/pages/space/spaceApi.ts
src/renderer/routes/app/mini-app/$appId.tsx
src/renderer/utils/miniAppKeepAlive.ts
src/shared/data/presets/mcpServers.ts
src/shared/data/presets/miniApps.ts
```
