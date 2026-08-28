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

## Configure access in Noteleaf

1. Open **Settings → AI & MCP**.
2. Leave **Allow AI changes** off while testing read access.
3. Use one of the connection methods below.
4. Enable changes only when you want the connected client to create or update Noteleaf data.

The local HTTP service is disabled by default and binds only to `127.0.0.1`. Its private endpoint contains a random 192-bit token. Treat the complete URL as a password and use **New private link** if it is ever exposed.

## Claude Desktop: private local connection

Noteleaf can run as a standard stdio MCP server without opening a network port.

1. In **Settings → AI & MCP**, select **Copy configuration**.
2. Open Claude Desktop's local MCP developer configuration.
3. Merge the copied `noteleaf` entry into the existing `mcpServers` object.
4. Completely restart Claude Desktop.
5. Ask: “Use Noteleaf to list my notebooks.”

The generated configuration points at the installed Noteleaf executable, runs its bundled MCP entry script in Electron's Node mode, and passes the exact Noteleaf data directory. No separate Node.js installation is required. Noteleaf may remain open; SQLite WAL mode and a busy timeout allow the UI and MCP process to share the local library safely.

Anthropic now also supports local desktop extensions and remote Streamable HTTP connectors. See its [local MCP guidance](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) and [remote MCP guidance](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers).

## ChatGPT: temporary HTTPS connection

ChatGPT needs a publicly reachable HTTPS MCP endpoint; it cannot call a loopback address on your computer directly. The official [OpenAI MCP server quickstart](https://developers.openai.com/plugins/build/app-quickstart) describes the Streamable HTTP `/mcp` transport and using an HTTPS tunnel during development.

1. Turn on **Local HTTP endpoint** in Noteleaf.
2. Copy the private endpoint. It resembles `http://127.0.0.1:37931/mcp/<private-token>`.
3. Start a trusted temporary tunnel to port `37931`, for example `ngrok http 37931`.
4. Replace `http://127.0.0.1:37931` in the copied endpoint with the tunnel's HTTPS origin. Preserve `/mcp/<private-token>` exactly.
5. In ChatGPT's plugin/custom-connector developer settings, add that complete HTTPS endpoint and test the connection.
6. Stop the tunnel when finished.

For a permanent public connector, use a hosted service with OAuth instead of a long-lived tunnel to a personal computer. The bundled endpoint is designed for personal and development use.

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
