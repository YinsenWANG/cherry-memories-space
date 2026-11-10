# Cherry-Studio-Memories architecture

> This page describes the earlier SiYuan implementation. See [npm Space architecture](architecture-npm-backend.md) for the current implementation.

A Space is one SiYuan workspace. The community default is a local kernel and local workspace; a remote Space is an independently deployed SiYuan service selected by URL and token. A signed-in personal user or enterprise employee can configure the same remote endpoint on multiple devices. Cherry does not provision that backend, tie it to account login, implement a synchronization engine, or guarantee multi-member permissions.

```text
Cherry Assistant ─┐                    ┌─ Memories database
Other agents ────┼─ authenticated MCP ┼─ Agent Operating Guide + Skills
Space mini app ──┘                    └─ SiYuan pages / editor
                      │
               local kernel OR remote SiYuan workspace
```

On a new Cherry database, `SharedMemoriesSeeder` creates an enabled builtin MCP row and associates it with the seeded Cherry Assistant. A lifecycle-managed Space service launches the source-side sidecar scripts using Electron's Node runtime. The scripts, guides, main-process locale catalogs and the existing i18next package are included as application resources; the SiYuan executable and GUI are installed separately. i18next was already a development dependency used by Cherry; exposing its CommonJS build to the sidecar adds one runtime library and no new package to the dependency manifest. If found, the local kernel receives a private workspace, creates its own API token, and is initialized idempotently. Once initialization completes, Cherry fills the initially empty local MCP authorization header and reconnects the server. The access code for the SiYuan editor lives in the local Space data directory. If the kernel is absent, the local Space page explains how to install it. A port collision is reported rather than adopting an unrelated process.

Settings → Space edits the existing MCP row's endpoint and authorization, and can test the saved connection. The Space page and sidecar pick up a new backend after an application restart. Switching from local to remote clears the local token field so it is not sent to the new endpoint. The local token is stored in SiYuan's workspace configuration and Cherry's existing MCP configuration; remote tokens use the same MCP configuration mechanism. Existing user edits, disabled servers and removed bindings are not re-created by the fresh-install-only seeder.

Bootstrap uses the existing `@modelcontextprotocol/sdk` and SiYuan HTTP API to create the notebook, guide and skill index, native attribute-view database, and an example skill without overwriting existing documents. Existing database select options are retained. Source Agent and dates are writer-supplied metadata, not identity proofs. SiYuan's MCP token has administrator access to the entire connected workspace. Its page permissions, user isolation, history deletion and backup handling are not provided or enforced by this fork.

Only explicitly shared workspace content belongs in Space: private chats and personal memory are not automatically synchronized or imported. Agent decisions about saving, retrieval, conflicting facts and deletion still depend on the model and its instructions. The recorded model run in [phase 2 verification](verification-phase2.md) demonstrates both successful recall/update/delete and failures to populate metadata or initially read the full guide. There is no background transcript collection, embeddings service, CRDT, or self-built synchronization layer.
