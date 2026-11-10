# ChatGPT Space comparison and product boundary

> This comparison records the earlier SiYuan version. See [npm Space architecture](architecture-npm-backend.md) for the current implementation and its limits.

This document condenses the supplied research note `/Users/cherryai001/HermesRuntime/scratch/cherry-space-delta.md` (2026-11-09). It describes the product comparison, not a claim of feature parity. The [OpenAI sharing and data help page](https://help.openai.com/en/articles/20001544-chatgpt-space-sharing-data-and-controls) was checked on 2026-11-09: Space replaces Library for accounts with access while Projects remain separate; pages are editable and can be organized within pages; sharing supports view or edit access, subject to managed-workspace controls. Sharing a page does not by itself share private chats or personal ChatGPT Memory, but personal information written onto the page becomes visible to its readers. Uploaded files follow the page's permissions, while linked external files retain their own permissions.

OpenAI's [Space feature page](https://chatgpt.com/features/space/) describes collaboration with agents and currently advertises pages that can stay updated from connected tools. The supplied note said Keep Updated was unavailable **at launch**; that is a dated observation, not a statement that the capability remains unavailable.

| Product concept | Cherry-Studio-Memories scope |
| --- | --- |
| Space with shared pages | One local or remote SiYuan workspace; SiYuan supplies the document editor and database. |
| Agent participates in shared work | Cherry Assistant and separately configured MCP clients can read and write the workspace. Model behavior is not guaranteed. |
| Personal memory stays private | Private chats and personal memory are not automatically imported or synchronized. Anything explicitly written into Space becomes part of the shared workspace. |
| Shared, hosted space | Multiple devices may target the same independently hosted SiYuan endpoint. This fork does not provide hosting, account-based provisioning, offline merge, or a sync engine. |
| Page access controls | Not implemented by this fork. A SiYuan API token used by MCP has administrator access to the whole connected workspace. |
| Real-time collaboration, comments and automatic page updates | Not implemented by this fork. |

The local community shape is intended to work without a network connection once SiYuan is installed; offline operation has not yet been independently tested. The remote shape relies on the backend for availability, synchronization, backups and member access. It must not be described as providing ChatGPT's page-level permission model or an automatically provisioned cloud account.

See [architecture](architecture.md) and [phase 2 verification](verification-phase2.md) for the implementation and observed behavior.
