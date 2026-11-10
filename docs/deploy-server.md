# Deploy the Space server

The server requires Node.js 24.16 or newer, or a compatible Bun runtime, and a persistent private data directory. It does not require a separately installed database. The following commands run the package from this checkout:

```sh
cd packages/cherry-memories-server
npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
export BETTER_AUTH_SECRET='replace-with-a-long-random-secret-of-at-least-32-characters'
export BETTER_AUTH_URL='https://space.example.com'
export CHERRY_MEMORIES_ALLOWED_ORIGINS='null'
node src/cli.mjs --host 127.0.0.1 --port 3000 --data-dir /var/lib/cherry-memories
```

Store the secret in the service manager's protected environment and keep it stable across restarts. The `null` origin permits requests from Electron's file-origin renderer; include the exact renderer origin instead where one is available. The server also accepts its own public origin. Restrict access to the server and account-registration endpoint to the users you intend to host; account registration is enabled. Use HTTPS and a reverse proxy. For example, a Caddy site can terminate TLS and proxy to the loopback listener:

```caddyfile
space.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Create an account with the Better Auth email endpoint from a trusted client, substituting a real address and a strong password:

```sh
curl --fail-with-body 'https://space.example.com/api/auth/sign-up/email' \
  -H 'Origin: https://space.example.com' -H 'Content-Type: application/json' \
  --data '{"name":"User","email":"user@example.com","password":"replace-with-a-strong-password"}'
```

In Cherry, open **Settings → Space**, select remote, enter the server URL, and sign in with that account. Save the connection and test it. Restart Cherry when switching modes so the local sidecar lifecycle follows the saved choice. Each account gets a separate default Space. Other agents can use `/setup` for connection instructions and `/mcp` for Streamable HTTP; treat the bearer session as a credential.

Run only one server process per data directory. Its exclusive lock is `server.lock`; the stdio bridge connects to the running HTTP server rather than opening the files itself. If a crash leaves the lock behind, confirm the recorded PID is no longer the owner before removing the stale file. Stop the server before backing up the complete data directory, including `spaces.sqlite`, every Space's `.eidos` file and Skills directory. Do not run multiple replicas against the same directory.

For stdio-only MCP clients, connect to a running server with `node src/cli.mjs --stdio --url <server-url> --token-file <private-token-file>`. The token file must be readable only by its owner. Local Cherry's `/setup` page includes a ready-to-copy configuration using its Electron executable and endpoint file, so it reads the current random port and token whenever an agent starts. The server does not include hosting, account recovery, live collaboration or SiYuan migration.
