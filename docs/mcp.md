# Noteleaf MCP integration

Noteleaf includes a local Model Context Protocol (MCP) server. Compatible AI clients can navigate a large Noteleaf library, search it, read complete Markdown pages, inspect daily tasks, and—with explicit write access—create or update pages and tasks.

## Available tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_workspace_overview` | Read | List notebook IDs, names, and page/section counts. |
| `list_sections` | Read | List sections in a selected notebook. |
| `list_pages` | Read | List sidebar and inline child pages in a section. |
| `search_notes` | Read | Search titles and Markdown content using SQLite FTS5. |
| `get_page` | Read | Read a complete page as Markdown with its stable location and revision. |
| `list_tasks` | Read | Read daily tasks and their workflow status. |
| `create_page` | Write | Create a Markdown-backed page in an existing section. |
| `update_page` | Write | Rename, replace, append, or prepend page content. |
| `create_task` | Write | Add a dated task. |
| `update_task` | Write | Change a task title, date, or status. |

Write tools are not advertised until **Allow AI changes** is enabled. Noteleaf deliberately exposes no delete tools in this first version.

## Enable AI access

1. Open **Settings → AI access**.
2. Turn on **Enable AI access**.
3. Leave **Allow AI to make changes** off while testing read access.

That single switch starts Noteleaf's private local MCP service and automatically configures Claude Desktop, ChatGPT Desktop, and local Codex clients. The connection stays available while Noteleaf is running, so an AI client reads the library directly through MCP—there is no per-question export or reader script.

The HTTP service binds only to `127.0.0.1`. Its endpoint contains a random 192-bit token and is shown only inside the collapsed **Technical details** section. Treat the complete URL as a password.

## Claude Desktop: private local connection

Noteleaf configures Claude Desktop automatically on Windows and macOS—there is no JSON to copy.

1. Turn on **Enable AI access**.
2. If Noteleaf shows **Restart required**, completely quit and reopen Claude Desktop once.
3. Ask: “Use Noteleaf to list my notebooks.”

Noteleaf atomically merges only `mcpServers.noteleaf` into Claude Desktop's existing configuration and preserves every unrelated setting and MCP server. Turning AI access off removes only that Noteleaf entry. If Claude's configuration contains invalid JSON, Noteleaf leaves the file unchanged and shows the problem in Settings.

The generated connection points at the installed Noteleaf executable and exact Noteleaf data directory. No separate Node.js installation is required. Noteleaf may remain open; SQLite WAL mode and a busy timeout allow the UI and MCP process to share the local library safely.

Anthropic now also supports local desktop extensions and remote Streamable HTTP connectors. See its [local MCP guidance](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) and [remote MCP guidance](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers).

## ChatGPT Desktop and Codex local clients: private local connection

Current ChatGPT Desktop releases support local MCP servers and share `~/.codex/config.toml` with the Codex CLI and Codex IDE extension. Noteleaf configures that file automatically on Windows and macOS.

1. Turn on **Enable AI access**.
2. If ChatGPT Desktop was already open, completely quit and reopen it once.
3. In ChatGPT Desktop, type `/mcp` to confirm that **noteleaf** is available.
4. Ask: “Use Noteleaf to list my notebooks.”

Noteleaf adds a clearly marked managed block for `mcp_servers.noteleaf` and preserves every unrelated Codex setting and MCP server. Turning AI access off removes only that managed block and stops the loopback service immediately. If the TOML file is invalid or already contains a manually managed `noteleaf` server, Noteleaf leaves it unchanged and explains how to resolve the conflict.

This local connection uses Noteleaf's tokenized `127.0.0.1` Streamable HTTP endpoint, so no API key, tunnel helper, or separate Node.js installation is required. Keep Noteleaf open while using it. The shared config also makes Noteleaf available to the Codex CLI and IDE extension on the same computer. ChatGPT and Codex still apply their own tool-approval policy; Noteleaf independently withholds all write tools until **Allow AI to make changes** is enabled.

See OpenAI's [local MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for the supported ChatGPT Desktop and Codex flow.

On an organization-managed computer, an administrator's [MCP allowlist](https://learn.chatgpt.com/docs/enterprise/managed-configuration) can still disable the Noteleaf entry; Noteleaf does not bypass managed ChatGPT or Codex policy.

## ChatGPT on the web: optional private tunnel

ChatGPT on the web runs in the cloud and cannot directly call a loopback address on your computer. OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) can bridge a private local server for developer-mode use, but it requires an OpenAI Platform tunnel, a runtime API key, and the appropriate organization or workspace permissions.

1. Turn on **Enable AI access** in Noteleaf.
2. Select **ChatGPT web setup**. Noteleaf opens OpenAI's guided Secure MCP Tunnel setup.
3. Create a tunnel in OpenAI Platform, configure `tunnel-client` with its tunnel ID and runtime API key, and point it at the tokenized endpoint shown under **Technical details**.
4. In the intended ChatGPT workspace, enable developer mode and create an app that uses that tunnel.
5. Keep both Noteleaf and `tunnel-client run` running while ChatGPT web uses the library.

This account authorization cannot be silently performed by a desktop application: it is deliberately protected by OpenAI workspace permissions. After it is completed, ChatGPT invokes Noteleaf's MCP tools directly; you do not copy note content or run a reader script for each question.

## Safe update behavior

- `update_page` requires the exact `updatedAt` revision returned by the latest `get_page` call. If the page changed meanwhile, Noteleaf rejects the update and asks the client to read it again.
- Text protected with the editor's shield button is removed from `get_page` responses and cannot be discovered through `search_notes`. A page containing protected text rejects AI content changes so hidden content cannot be accidentally overwritten; title-only changes remain available.
- Private encrypted pages are excluded at the database-query boundary from notebook totals, section counts, page listings, search, reads, and writes—even while the user has unlocked the vault in the Noteleaf window.
- Append and prepend modes keep existing Markdown; replace mode replaces the complete body.
- Linked external Markdown pages are read from and written to their original file instead of creating a disconnected copy.
- When the Noteleaf window regains focus, clean open pages refresh from changes made by another local MCP process. A page with unsaved local typing is not automatically reloaded.
- Backups include all MCP-created content because MCP uses the same SQLite repository as the desktop UI.

## Example requests

- “Search Noteleaf for the latest Natural Retreats deployment status and summarize it.”
- “List all pages in the AWS Pipelines section.”
- “Read the Project Status page, then append today's deployment result under a dated heading.”
- “Create a page called Incident Follow-up in this section with these action items.”
- “Show today's Noteleaf tasks and mark the release task complete.”

## Privacy notes

Noteleaf itself remains local-first and does not send content anywhere. Once an MCP client invokes a read tool, the selected AI provider receives that returned content under the provider's own data handling terms. Text marked as protected is redacted before MCP responses leave Noteleaf, but it remains stored locally in the database and backups. Private encrypted pages are never exposed through MCP. Connect only clients and tunnel providers you trust, keep the endpoint private, and review write approvals carefully.
