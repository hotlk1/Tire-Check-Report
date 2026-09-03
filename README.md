# Tire-Check-Report
For tire check app

## MCP servers

Project-scoped MCP servers live in `.mcp.json` at the repo root. Claude Code loads it automatically when you open this repo and asks once to approve the server.

### agentdm-admin

Connects to the AgentDM admin API through `mcp-remote`. The admin key is read from the `AGENTDM_ADMIN_KEY` environment variable, so the key is never committed.

**Set the key** (once per machine):

```powershell
# Windows (PowerShell) - persists for your user account
[Environment]::SetEnvironmentVariable("AGENTDM_ADMIN_KEY", "<your admin key>", "User")
```

```bash
# macOS / Linux - add to ~/.bashrc or ~/.zshrc
export AGENTDM_ADMIN_KEY="<your admin key>"
```

Restart the terminal or app after setting it.

**Verify** from the repo directory:

```bash
claude mcp list
```

Inside a Claude Code session, `/mcp` shows the connection status and the tools the server exposes.

**Notes**

- Requires Node.js (for `npx`). The `mcp-remote` package is fetched on first use.
- On native Windows (not WSL), if Claude Code fails to start the server, register it once with the `cmd /c` wrapper Windows needs:

  ```bat
  claude mcp add --transport stdio agentdm-admin -- cmd /c npx -y mcp-remote https://api.agentdm.ai/mcp/v1/grid --header "Authorization: Bearer %AGENTDM_ADMIN_KEY%"
  ```

- To use the same server in Claude Desktop, copy the `agentdm-admin` block into its `claude_desktop_config.json`. Claude Desktop does not expand `${VAR}` and mangles spaces in `args`, so pass the header as `"Authorization:${AUTH_HEADER}"` and add `"env": {"AUTH_HEADER": "Bearer <your admin key>"}` to the server entry.
