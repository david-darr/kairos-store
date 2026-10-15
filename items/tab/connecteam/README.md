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
