# PSA Command 1.4.0

Use PSA Sales and optional Taskbar from Kairos, without needing the PSA website for normal sales work. This updates the existing psa_command tab and retains its saved connections. Install only after your PSA administrator releases the compatible contacts, templates, approvals and campaign API and sending worker.

## Start here

Open Account & setup and sign in to your PSA employee account using the private form. Your password is transient; the private website session and delegated API connection are separate and stored encrypted for your Kairos user. Human sign-in may need renewal after 12 hours. Delegated keys expire after the chosen 7, 30 or 90 days. Renewing a sign-in does not silently grant new permissions.

Choose the school access and optional capabilities you need. Approved sending is separately delegated. Library, commission and team management are PSA-admin-only opt-ins. Old keys do not gain these permissions. Mail credentials belong in private account controls, never in chat.

## Workspaces

- My work: actual school-stage counts, due follow-ups, overdue PSA/Taskbar tasks, team account ownership and recent activity. Missing connections and errors are shown explicitly.
- Email outreach: Start here; whole-campaign and one-time request review; follow-up plans; sending progress; school replies; shared templates and PDF catalog.
- Tasks & school updates: create tasks, log activity and change school ownership using normal employee access rules and confirmation.
- Account & setup: private employee sign-in, explicit delegation, revocation, chat-tool setup and optional manual Taskbar connection.

Phone layouts use compact section/action selectors, stacked metrics and readable rep cards. Colors and controls inherit Kairos appearance rather than forcing a separate theme.

## Use any Kairos chat

Under Account & setup, add/check PSA Command chat tools using the existing MCP setup. In each existing or new chat, select PSA Command in that chat's Integrations menu. Adding a server does not automatically select it in every chat. New or changed tool definitions must be reviewed in Tool Store > Tools.

Ask for psa_capabilities first to check actual server availability and the connected key's permissions. Tools cover schools, role-based contacts, imports, reviewed ownership changes, discovery/territory planning, tasks, templates/PDF uploads, sequence definitions, seasonal commissions, team access, campaign preparation/status/stop and threaded reply preparation. PSA and Taskbar enforce the current connected employee role on every call. Taskbar is optional.

Write tools return a review before a confirmed operation. Large file bytes need not be pasted in chat: the companion PSA CLI supports uploading a specifically chosen local PDF or template JSON. PDF uploads are limited to 10 MB, template JSON to 1 MB; template selections support up to three PDFs totaling 15 MB. Queued messages retain reviewed PDF versions.

## Sending and approvals

An assistant cannot approve itself, obtain the private website JWT or choose another sender. Review the exact contacts, personalized messages, PDFs, schedule, daily cap and end date in the private Email outreach controls. Campaign approval covers only the displayed fixed audience; future matching schools are not silently added. One-time batch approval does not authorize future follow-ups.

Queued mail requires the PSA sending service, either on existing compatible backend compute in opt-in web mode or on an external worker. This release reuses the existing backend with a due-work cloud clock. Host startup or service limits can delay mail. SMTP/IMAP connectivity was verified on the current deployment; recheck if changing hosts, because published platform restrictions can differ. Missing/offline worker status is visible. Campaign automation is disabled on the server by default and must be enabled deliberately after a controlled live test. Replies, stop requests, bounced mail, ownership changes, expired/revoked delegation and changed approval inputs can block further sends. An in-flight message may finish after stopping. Unknown SMTP outcomes are not automatically resent; SMTP acceptance is not proof of inbox delivery.

Pause, revoke or cancel from the native controls when appropriate. Agents can prepare, read, pause or cancel within their delegated access; final sending approval and resuming an authorized campaign are private human actions. Credentials and delegation management are also human-only. New tool access never silently expands old keys.

## Updates and privacy

The tab source lives in Kairos's user-data custom-tabs area, so app updates do not replace it. Source updates require approval of their exact fingerprint; restart Kairos when already mounted Python code changes. New chat tools require their separate review. Updating source preserves existing saved tab data.

This package contains source only. No saved sessions, credentials, employee records or live account data are included. Outside notes, emails and tool results are untrusted data. Network requests use configured fixed API paths; credentials are not destination arguments. The human session broker is excluded from model tools. Review both the tab and MCP connections when removing access; revoke the corresponding PSA/Taskbar keys as needed.

## License

MIT. Submitted by david-darr for the existing PSA Command listing.

### Connection access
New connections default to **Full access for my PSA role**. This grants CRM read/write and all additional capabilities allowed by the authenticated employee role. The connection form explicitly delegates execution of human-approved sends; it never delegates approval itself. Custom read-only or read/write access remains available. Existing keys retain their original scopes until their owner explicitly reconnects with full access. That private sign-in upgrades the same active key without replacing the key in chat integrations or extending its expiry. Custom sign-in renewal leaves permissions unchanged. The PSA API must support POST /api/agent-keys/{id}/full-access.

### School-specific outreach stops
Contact tools accept school_do_not_contact and school_suppression_reason independently of global do_not_contact and suppression_reason. A school-only stop never lifts a global opt-out. This update needs the school contact suppression migration and compatible PSA API.


### Local PDF file references (1.4.3)
Use `psa_upload_pdf_file` with an explicitly selected absolute `.pdf` path on the computer running this MCP server. The preview shows filename, size and `expected_sha256`. Once approved, repeat with `confirm: true` and the returned fingerprint. The bridge transfers the PDF directly to the existing catalog API without putting base64 into chat, and returns its reusable attachment ID. A changed file requires re-review. Administrators need `library:manage`; the API checks the same role again. The existing inline upload tool remains supported. No sending or campaign approval is performed.

The PDF must be a regular locally available file, at most 10 MiB. Relative/network/device paths, URLs, symlinks, reparse points and folders are rejected. A path refers to the MCP server's computer, not the cloud PSA backend. Download or sync Drive PDFs locally before using this tool; private Drive IDs are not resolved and Google credentials are never extracted.

After updating, Check the PSA Command MCP connection and review/accept the new tool in Tool Store > Tools before using it in a chat. Normal tab-source approval/reload still applies. No new PSA key is required.


## School Sales / Business Sales (1.5.0)

Choose the sales workspace in PSA Command. Requests, private reviews, template JSON uploads and overview caches stay in that area; PDFs, sign-in and the existing saved API key stay shared. Chat tools accept `workspace: "business"` explicitly; new business search/create/edit tools default to Business Sales. Employee/admin and ownership rules still apply. Publish only after the compatible PSA backend migration and release. Updating source files never clears `connections.json`, `human-session.json` or tab encryption data.


## Restoring tools held for review (1.5.1)

The 1.5.0 workspace selector added an optional workspace argument to PSA tool
schemas. Existing Kairos connections hold changed/new tools for explicit human
review. Unchanged Taskbar tools and sales_overview can remain available, so a
reachable server does not mean all PSA tools are enabled. This is not evidence
that the PSA API key lost its scope.

For immediate recovery with any installed version: open Tool Store > Tools,
find the existing PSA Command connection, run Check, review its held PSA tools
and accept them. Keep the connection ID and keys. Do not remove/recreate the
connection: scheduled jobs and bots may reference its ID. Retry a read-only
PSA school/team check before resuming hand-offs; do not replay missed writes.

PSA Command 1.5.1 also shows held PSA tools under Account & setup, with a list
and an explicit Enable reviewed PSA tools button. Acceptance happens only on
that human click through Kairos's authenticated review endpoint. Nothing is
automatically accepted. No task runs, emails, permissions or credentials change.
This patch leaves every 1.5.0 tool name, description and input schema unchanged.
