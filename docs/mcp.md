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

That single switch starts Noteleaf's private local MCP service and automatically configures supported local clients. The connection stays available while Noteleaf is running, so an AI client reads the library directly through MCP—there is no per-question export or reader script.

The HTTP service binds only to `127.0.0.1`. Its endpoint contains a random 192-bit token and is shown only inside the collapsed **Technical details** section. Treat the complete URL as a password.

## Claude Desktop: private local connection

Noteleaf configures Claude Desktop automatically on Windows and macOS—there is no JSON to copy.

1. Turn on **Enable AI access**.
2. If Noteleaf shows **Restart required**, completely quit and reopen Claude Desktop once.
3. Ask: “Use Noteleaf to list my notebooks.”

Noteleaf atomically merges only `mcpServers.noteleaf` into Claude Desktop's existing configuration and preserves every unrelated setting and MCP server. Turning AI access off removes only that Noteleaf entry. If Claude's configuration contains invalid JSON, Noteleaf leaves the file unchanged and shows the problem in Settings.

The generated connection points at the installed Noteleaf executable and exact Noteleaf data directory. No separate Node.js installation is required. Noteleaf may remain open; SQLite WAL mode and a busy timeout allow the UI and MCP process to share the local library safely.

Anthropic now also supports local desktop extensions and remote Streamable HTTP connectors. See its [local MCP guidance](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) and [remote MCP guidance](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers).

## ChatGPT: one-time account connection

ChatGPT runs in the cloud and cannot directly call a loopback address on your computer. OpenAI therefore requires a one-time authenticated [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) connection for a private local server.

1. Turn on **Enable AI access** in Noteleaf.
2. Select **Connect ChatGPT**. Noteleaf opens OpenAI's guided Secure MCP Tunnel setup.
3. Complete the one-time tunnel and ChatGPT connector authorization in the intended workspace.
4. Keep Noteleaf open when you want ChatGPT to access the library.

This account authorization cannot be silently performed by a desktop application: it is deliberately protected by OpenAI workspace permissions. After it is completed, ChatGPT invokes Noteleaf's MCP tools directly; you do not copy note content or run a reader script for each question.

## Safe update behavior

- `update_page` requires the exact `updatedAt` revision returned by the latest `get_page` call. If the page changed meanwhile, Noteleaf rejects the update and asks the client to read it again.
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

Noteleaf itself remains local-first and does not send content anywhere. Once an MCP client invokes a read tool, the selected AI provider receives that returned content under the provider's own data handling terms. Connect only clients and tunnel providers you trust, keep the endpoint private, and review write approvals carefully.
