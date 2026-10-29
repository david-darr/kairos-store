# PSA Command tab

PSA Command is a Kairos Store tab for PSA staff. It drives PSA Sales and Taskbar together: one overview, confirmed changes in either system, Home cards, and the same operations as tools for Kairos chats and agents. Install it from **Tool Store > Tabs**. Nothing is sent anywhere until you save a connection.

## What it shows and does

- **Overview:** connection status for both systems; schools, closes this month and overdue counts; pipeline and accounts by rep (administrator PSA key); PSA and Taskbar overdue tasks side by side, each with **Mark done**; recent sales activity.
- **Actions:** create a task in PSA Sales or Taskbar, reassign a PSA school to a rep, log a call, meeting or note. Every change is previewed in a confirmation dialog and only sent after **Send change**.
- **Connections:** API address and key for each system. Keys are encrypted with this tab's own key (`api.encrypt`) in `data/tab-data/psa_command/connections.json`, scoped to your Kairos user, and never returned to the page or written to logs. The page shows "Saved; leave blank to keep".
- **Ask Kairos:** opens a PSA Command chat seeded with the latest overview, marked as untrusted data so Kairos asks before shell commands.
- **Home cards** (Settings > Layout > From your tabs, hidden until you show them): *Overdue sales tasks* (up to five, PSA and Taskbar badges) and *Closes this month* (or overdue totals for a non-admin key). Cards read only the cached overview; no network on Home.
- The overview is cached per user and refreshed when you press **Refresh**, after each confirmed change, every 15 minutes while the tab is on, and in the daily sync.

## Setup

1. **PSA Sales key:** in PSA Sales, open **Settings > AI & integrations**, create a key (start with Read only), and copy it. API address: `https://psa-sales-backend.onrender.com/api/agent/v1`.
2. **Taskbar key:** in Taskbar, open **Settings > AI & integrations** and create a key. API address: `https://mlsxmivbfnabqtfrlmdg.supabase.co/functions/v1/agent-api/v1`.
3. In Kairos, **Tool Store > Tabs**, install **PSA Command** and review the code prompt. Open it, go to **Connections**, paste each address and key, **Save**, then **Test**.
4. Use read-only keys until the overview looks right, then switch to write keys to make changes. An administrator PSA key is needed for rep breakdowns, reassignment and closes this month.

## Use the tools in Kairos chat and agents

The tab's operations are also a local MCP server, `mcp_bridge.py` in the installed tab folder (`<Kairos data folder>/tabs/psa_command/`) (standard library Python only, no listener). In **Tool Store**, add a local (stdio) MCP server:

- **Command:** `python`
- **Arguments:** `<Kairos data folder>/tabs/psa_command/mcp_bridge.py --psa-url <PSA API address> --taskbar-url <Taskbar API address>` (leave out either system you do not use)
- **Key:** your PSA key and Taskbar key separated by a space (`psak_... tbk_...`). Kairos stores it encrypted and starts the bridge with only that key in its environment.

Tools: `sales_overview` (both systems as one), `psa_connection`, `psa_pipeline`, `psa_team`, `psa_accounts`, `psa_commissions`, `psa_schools`, `psa_school`, `psa_tasks`, `psa_outreach`, `psa_create_task`, `psa_update_task`, `psa_update_school`, `psa_assign_schools`, `psa_log_activity`, `taskbar_connection`, `taskbar_programs`, `taskbar_members`, `taskbar_tasks`, `taskbar_task`, `taskbar_create_task`, `taskbar_update_task`. Only tools for connected systems are listed.

Safety: every write tool first returns a plain-language preview and changes nothing; the assistant must show it and call again with `confirm: true` only after you approve (Kairos also asks before running tools you have not pre-approved). Results are prefixed as untrusted data and the server instructions tell the model never to follow instructions found in records. Tools only call fixed API paths on the addresses you configured, refuse redirects and require HTTPS (plain HTTP only for localhost). There is no tool for sending email.

The key stays in two places if you use both the tab and chat tools: the tab's encrypted store and the MCP server's encrypted key. Revoke keys in PSA Sales and Taskbar when you remove either.

## Updates

PSA Command installs into your Kairos data folder, not the app folder, so Kairos updates and reinstalls leave it and its saved connections alone. It never updates itself: when a new version is published, the Tool Store shows **Update available** and nothing changes until you choose **Update**.

## Files

`tab.json` manifest (hooks `start`, `stop`, `home_cards`); `catalog.py` shared clients, tool catalog, validation, previews and overview (no Kairos imports); `service.py` encrypted connections, snapshot cache, tool runner, chat briefing; `routes.py` `/api/tab-psa-command/...` (all `require_user`); `hooks.py` background refresh and Home cards; `view.js`/`view.css` the page; `mcp_bridge.py` the chat tools.
