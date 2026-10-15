# Connecteam for Kairos

A user-folder tab built on core.tab_api v1. All visual surfaces use Kairos
appearance tokens and shared controls.

## Screens

Overview, a weekly shift calendar with create/edit/delete, time activity
records and live clock-in/out, task boards and task creation/completion,
people search, forms/submissions, job details, and connection settings.

Team chat, Time off, and Updates are excluded from the workspace navigation.
The assistant retains access to supported public API operations.

## Assistant

The right panel uses Kairos's shared persistent chat renderer, model picker,
streaming, Stop and permission prompts. In Settings, enter your API key and
press **Save & enable assistant**. This creates/checks a normal local stdio
MCP connection and selects it for the tab's user-scoped conversation.
Changing the key or region marks the previous assistant binding stale.

mcp_server.py is a standalone server bundled with this tab, with no Kairos
imports. It consumes MCP_API_KEY supplied by Kairos's clean stdio launcher
and --region global|au. It exposes API operations, bounded file transfer and
official endpoint-schema lookup. api_index.json contains public reference
metadata, never credentials. Existing MCPs can also be selected in Settings.
Held tool changes must be reviewed manually in Tool Store.

## Approval and sharing

After source changes, review/approve this folder in Tool Store > Tabs > Yours.
Already-loaded Python requires an app restart. Saved tab data remains.
Share this source folder only; keys and runtime data live outside source.
The local MCP is installed on the receiving machine by the same setup flow.
A separate public MCP server listing still requires a hosted HTTPS service.

Reference: https://developer.connecteam.com/llms.txt

## Scheduling V2

Schedule defaults to V2. Use its Scheduling API selector to choose V1 for
companies that have not migrated to Connecteam JS Vision. The choice is
saved per user and shared with the assistant. Scheduler discovery stays V1;
shift reads, creation, updates and deletion use the selected version.

V2 renders one group per shift, allows multiple assignees and open spots,
and edits whole groups with explicit isEditForAllUsers. Unchanged membership
is omitted from updates; changed membership sends the complete selected list.
PUT uses shiftId. V2 deletion removes every assignment in the group and is
labelled accordingly. No failed write is automatically retried on V1.

The MCP includes connecteam_scheduler_guide and connecteam_scheduler_request.
Additional scheduling operations remain available through the general API tool.
After updating, restart Kairos, Check the MCP connection and review its new
held tools in Tool Store before using the assistant. Live read-only tests through the MCP stdio protocol passed for scheduler
discovery, V1/V2 shift lists across three schedulers, and individual shifts.

Official guide: https://developer.connecteam.com/docs/scheduler-shifts-vision

## Transport repair (3.1.1)

Use httpx for API and attachment transport, matching the working tab. The
previous urllib client received Cloudflare HTTP 403 / error 1010
(browser_signature_banned) even with a valid key. This was a client-signature
block, not a JS Vision migration failure. Upstream error status/details are
now preserved with credential redaction. Redirect and file-size checks remain.
No test credentials are bundled or saved. After approval, restart/recheck the
MCP to replace any running process using the old client.
