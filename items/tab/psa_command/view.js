import { api, el, toast, confirmDialog, emptyState } from "/static/js/api.js";
import { mountSessionChat } from "/static/js/sessionChat.js";

const BASE = "/api/tab-psa-command";
const LABEL = { psa: "PSA Sales", taskbar: "Taskbar" };

function when(value) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function field(label, control) {
  if (!control.id) control.id = "psa-field-" + Math.random().toString(36).slice(2);
  return el("div", { class: "field" }, [el("label", { text: label, for: control.id }), control]);
}
function options(select, rows, placeholder) {
  select.replaceChildren(el("option", { value: "", text: placeholder }),
    ...rows.map(([value, text]) => el("option", { value: String(value), text })));
}
function isoFromDate(value) {
  // A date input gives a local calendar day; send end of that day with its offset.
  if (!value) return null;
  return new Date(value + "T17:00:00").toISOString();
}

export async function render(container) {
  container.replaceChildren();
  let disposed = false, mode = "overview", data = null, settings = null, closeChat = () => {}, loadToken = 0;
  const wrap = el("div", { class: "view-constrained psa-view" });
  const actions = el("div", { class: "psa-actions" });
  const heading = el("div", { class: "view-header" }, [
    el("div", {}, [el("h2", { text: "PSA Command" }),
      el("div", { class: "sub", text: "PSA Sales and Taskbar in one place. Every change is confirmed before it is sent." })]),
    actions,
  ]);
  const tabs = el("nav", { class: "psa-tabs", "aria-label": "PSA Command sections" });
  const content = el("div");
  const chatHost = el("div", { class: "psa-chat card", hidden: true });
  wrap.append(heading, tabs, content, chatHost);
  container.append(wrap);

  function button(text, action, kind = "") {
    const node = el("button", { class: "btn " + kind, text, type: "button" });
    node.addEventListener("click", async () => {
      if (node.disabled) return;
      node.disabled = true;
      try { await action(); }
      catch (error) { toast(error.message || "Something went wrong", "error"); }
      finally { node.disabled = false; }
    });
    return node;
  }

  async function run(tool, args) {
    return (await api(BASE + "/action", { method: "POST", body: JSON.stringify({ tool, arguments: args }) })).result;
  }

  // Writes: ask the server for a preview, show it, send only after the person agrees.
  async function perform(tool, args) {
    const preview = await run(tool, args);
    const summary = preview?.summary || "Send this change?";
    const ok = await confirmDialog({ title: "Confirm change in " + (preview?.system || "PSA"), message: summary,
      confirmLabel: "Send change", danger: false });
    if (!ok) return false;
    await api(BASE + "/action", { method: "POST", body: JSON.stringify({ tool, arguments: args, confirmed: true }) });
    toast("Done. " + summary);
    await load(false);
    return true;
  }

  function drawTabs() {
    tabs.replaceChildren(...[["overview", "Overview"], ["actions", "Actions"], ["connections", "Connections"]].map(([key, text]) =>
      el("button", { class: "btn quiet" + (mode === key ? " active" : ""), text, type: "button",
        "aria-pressed": String(mode === key), onclick: () => { mode = key; draw(); } })));
  }

  async function load(refresh) {
    const token = ++loadToken;
    content.replaceChildren(el("div", { class: "meta", text: refresh ? "Refreshing from PSA Sales and Taskbar..." : "Loading..." }));
    try {
      const [nextSettings, nextData] = await Promise.all([
        api(BASE + "/settings"), api(BASE + "/overview" + (refresh ? "?refresh=true" : "")),
      ]);
      if (disposed || token !== loadToken) return;
      settings = nextSettings; data = nextData;
      if (!settings.psa.key_saved && !settings.taskbar.key_saved && mode === "overview") mode = "connections";
      draw();
    } catch (error) {
      if (disposed || token !== loadToken) return;
      content.replaceChildren(el("div", { class: "card psa-error" }, [
        el("div", { class: "title", text: "PSA Command could not load" }),
        el("div", { class: "meta", text: (error.message || "Request failed") + ". Check your connection, then retry." }),
        button("Retry", () => load(true)),
      ]));
    }
  }

  function systemStatus(system) {
    const part = data?.[system] || {};
    if (!part.connected) return el("span", { class: "psa-pill", text: LABEL[system] + ": not connected" });
    if (part.error) return el("span", { class: "psa-pill warn", text: LABEL[system] + ": " + part.error });
    const who = [part.me?.name, part.me?.role, part.me?.workspace].filter(Boolean).join(" · ");
    return el("span", { class: "psa-pill ok", text: LABEL[system] + (who ? ": " + who : "") });
  }

  function stat(value, label) {
    return el("div", { class: "card psa-stat" }, [el("strong", { text: value ?? "–" }), el("span", { class: "meta", text: label })]);
  }

  function taskRow(system, task) {
    const meta = [when(task.due_at), task.owner, task.school, task.status].filter(Boolean).join(" · ");
    const row = el("div", { class: "psa-row" }, [
      el("div", { class: "psa-row-text" }, [el("div", { class: "title", text: task.title || "Untitled task" }),
        el("div", { class: "meta", text: meta })]),
    ]);
    const done = system === "psa"
      ? () => perform("psa_update_task", { task_id: task.id, version: task.version, status: "completed" })
      : () => perform("taskbar_update_task", { task_id: task.id, revision: task.revision, status: "Completed" });
    if (task.id && (task.version || task.revision)) row.append(button("Mark done", done, "quiet"));
    return row;
  }

  function overdueColumn(system) {
    const part = data?.[system] || {};
    const column = el("div", { class: "card psa-column" }, [
      el("div", { class: "psa-column-head" }, [el("div", { class: "title", text: LABEL[system] + " overdue" }),
        el("span", { class: "meta", text: part.connected && !part.error ? String(part.overdue_total ?? 0) : "" })]),
    ]);
    if (!part.connected) column.append(el("div", { class: "meta", text: "Connect " + LABEL[system] + " under Connections." }));
    else if (part.error) column.append(el("div", { class: "meta psa-warn", text: part.error }));
    else if (!(part.overdue_tasks || []).length) column.append(el("div", { class: "meta", text: "Nothing overdue." }));
    else column.append(...part.overdue_tasks.slice(0, 25).map((task) => taskRow(system, task)));
    return column;
  }

  function drawOverview() {
    const psa = data?.psa || {}, taskbar = data?.taskbar || {};
    const nodes = [el("div", { class: "psa-status" }, [systemStatus("psa"), systemStatus("taskbar"),
      el("span", { class: "meta", text: data?.generated_at ? "Updated " + new Date(data.generated_at).toLocaleTimeString() : "" })])];
    nodes.push(el("div", { class: "psa-stats" }, [
      stat(psa.totals?.schools, "schools in PSA"),
      stat(psa.closes_this_month, "closes this month"),
      stat(psa.connected && !psa.error ? psa.overdue_total : null, "overdue PSA tasks"),
      stat(taskbar.connected && !taskbar.error ? taskbar.overdue_total : null, "overdue Taskbar tasks"),
    ]));
    if ((psa.reps || []).length) {
      const table = el("table", { class: "psa-table" }, [
        el("thead", {}, [el("tr", {}, ["Rep", "Schools", "Pipeline", "Clients", "Closed this month", "Overdue"].map((h) => el("th", { text: h })))]),
        el("tbody", {}, psa.reps.map((rep) => el("tr", {}, [rep.name, rep.schools, rep.pipeline, rep.active_clients,
          rep.closes_this_month, rep.overdue_tasks].map((v, i) => el("td", { text: String(v ?? 0), class: i && rep.overdue_tasks && i === 5 ? "psa-warn" : "" }))))),
      ]);
      nodes.push(el("div", { class: "card psa-scroll" }, [el("div", { class: "title", text: "Pipeline and accounts by rep" }), table]));
    } else if (psa.connected && !psa.error && !psa.admin) {
      nodes.push(el("div", { class: "meta", text: "Rep breakdowns need a PSA Sales administrator key." }));
    }
    nodes.push(el("div", { class: "psa-split" }, [overdueColumn("psa"), overdueColumn("taskbar")]));
    const activity = psa.activity || [];
    nodes.push(el("div", { class: "card" }, [el("div", { class: "title", text: "Recent sales activity" }),
      ...(activity.length ? activity.map((item) => el("div", { class: "psa-row" }, [el("div", { class: "psa-row-text" }, [
        el("div", { text: [item.actor, item.kind, item.school].filter(Boolean).join(" · ") }),
        el("div", { class: "meta", text: (item.detail || "") + (item.at ? " · " + when(item.at) : "") })])]))
        : [el("div", { class: "meta", text: psa.connected ? "No recent activity." : "Connect PSA Sales to see activity." })])]));
    content.replaceChildren(...nodes);
  }

  function schoolPicker() {
    const query = el("input", { type: "search", placeholder: "Search schools by name, contact or email" });
    const select = el("select", { "aria-label": "School" });
    options(select, [], "Search first");
    const find = button("Search", async () => {
      const result = await run("psa_schools", { q: query.value.trim(), limit: 25 });
      const rows = (result.items || []).map((s) => [s.id, [s.school_name, s.owner_name, s.status].filter(Boolean).join(" · ")]);
      options(select, rows, rows.length ? "Choose a school" : "No matches");
    });
    return { select, node: el("div", { class: "psa-pair" }, [field("Find school", query), find]) };
  }

  function repOptions(select, placeholder) {
    options(select, (data?.psa?.reps || []).map((rep) => [rep.id, rep.name]), placeholder);
  }

  function drawActions() {
    const psaOn = settings?.psa?.key_saved, taskbarOn = settings?.taskbar?.key_saved;
    const panels = [];

    // Create a task in either system.
    const system = el("select", { "aria-label": "System" });
    options(system, [psaOn && ["psa", "PSA Sales"], taskbarOn && ["taskbar", "Taskbar"]].filter(Boolean), "Choose a system");
    const title = el("input", { maxlength: 240, placeholder: "Call the director about pricing" });
    const due = el("input", { type: "date" });
    const owner = el("select", { "aria-label": "Assign to" });
    const program = el("select", { "aria-label": "Program" });
    const extra = el("div");
    options(owner, [], "Me"); options(program, [], "Choose a program");
    system.addEventListener("change", async () => {
      extra.replaceChildren();
      try {
        if (system.value === "psa") {
          repOptions(owner, "Me");
          extra.append(field("Assign to", owner));
        } else if (system.value === "taskbar") {
          const [programs, members] = await Promise.all([run("taskbar_programs", {}), run("taskbar_members", {})]);
          const list = (x) => Array.isArray(x) ? x : (x?.items || []);
          options(program, list(programs).map((p) => [p.id, p.name || p.id]), "Choose a program");
          options(owner, list(members).map((m) => [m.id, m.name || m.full_name || m.display_name || m.email || m.id]), "Default assignee");
          extra.append(field("Program", program), field("Assign to", owner));
        }
      } catch (error) { if (!disposed) toast(error.message, "error"); }
    });
    panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Create a task" }),
      field("System", system), field("Title", title), field("Due date", due), extra,
      button("Review and send", async () => {
        if (!title.value.trim()) throw new Error("Enter a task title");
        if (system.value === "psa") {
          const args = { title: title.value.trim() };
          if (due.value) args.due_at = isoFromDate(due.value);
          if (owner.value) args.user_id = Number(owner.value);
          if (await perform("psa_create_task", args)) title.value = "";
        } else if (system.value === "taskbar") {
          if (!program.value || !due.value) throw new Error("Choose a program and due date");
          const args = { title: title.value.trim().slice(0, 140), program_id: program.value, due_at: isoFromDate(due.value) };
          if (owner.value) args.assignee = owner.value;
          if (await perform("taskbar_create_task", args)) title.value = "";
        } else throw new Error("Choose a system");
      }, "primary")]));

    if (psaOn) {
      const reassign = schoolPicker(), rep = el("select", { "aria-label": "New owner" });
      repOptions(rep, data?.psa?.admin ? "Choose a rep" : "Administrator key required");
      panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Reassign a school" }),
        reassign.node, field("School", reassign.select), field("New owner", rep),
        button("Review and send", async () => {
          if (!reassign.select.value || !rep.value) throw new Error("Choose a school and a rep");
          await perform("psa_assign_schools", { ids: [Number(reassign.select.value)], user_id: Number(rep.value) });
        }, "primary")]));

      const logged = schoolPicker(), kind = el("select", { "aria-label": "Activity type" });
      const detail = el("textarea", { rows: 3, maxlength: 2000, placeholder: "What happened" });
      options(kind, [["call", "Call"], ["meeting", "Meeting"], ["note", "Note"]], "Choose a type");
      kind.value = "call";
      panels.push(el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Log activity" }),
        logged.node, field("School", logged.select), field("Type", kind), field("Details", detail),
        button("Review and send", async () => {
          if (!logged.select.value || !detail.value.trim()) throw new Error("Choose a school and enter details");
          if (await perform("psa_log_activity", { school_id: Number(logged.select.value), kind: kind.value, detail: detail.value.trim() })) detail.value = "";
        }, "primary")]));
    }
    content.replaceChildren(panels.length && (psaOn || taskbarOn) ? el("div", { class: "psa-grid" }, panels)
      : emptyState({ title: "Nothing connected yet", hint: "Add a PSA Sales or Taskbar key under Connections.",
        actionLabel: "Open Connections", onAction: () => { mode = "connections"; draw(); } }));
  }

  function connectionCard(system) {
    const saved = settings?.[system] || {};
    const url = el("input", { type: "url", value: saved.url || "", placeholder: system === "psa"
      ? "https://psa-sales-backend.onrender.com/api/agent/v1" : "https://<project>.supabase.co/functions/v1/agent-api/v1" });
    const key = el("input", { type: "password", autocomplete: "off",
      placeholder: saved.key_saved ? "Saved; leave blank to keep" : (system === "psa" ? "psak_..." : "tbk_...") });
    const result = el("div", { class: "meta" });
    const where = system === "psa" ? "PSA Sales Settings > AI & integrations" : "Taskbar Settings > AI & integrations";
    return el("div", { class: "card psa-form" }, [
      el("div", { class: "title", text: LABEL[system] }),
      el("div", { class: "meta", text: "Create a key in " + where + ". Start read-only; use a write key to make changes from here." }),
      field("API address", url), field("API key", key),
      el("div", { class: "psa-actions" }, [
        button("Save", async () => {
          settings = await api(`${BASE}/settings/${system}`, { method: "PUT", body: JSON.stringify({ url: url.value, key: key.value || null }) });
          key.value = ""; key.placeholder = "Saved; leave blank to keep";
          toast(LABEL[system] + " saved");
        }, "primary"),
        button("Test", async () => {
          const me = await api(`${BASE}/settings/${system}/test`, { method: "POST" });
          result.textContent = "Connected as " + [me.name, me.role].filter(Boolean).join(", ");
        }),
        saved.key_saved ? button("Disconnect", async () => {
          const ok = await confirmDialog({ title: "Disconnect " + LABEL[system] + "?", message: "The saved key is removed from Kairos. Revoke it in " + LABEL[system] + " too if you no longer need it.", confirmLabel: "Disconnect" });
          if (!ok) return;
          settings = await api(`${BASE}/settings/${system}`, { method: "PUT", body: JSON.stringify({ clear: true }) });
          draw();
        }, "quiet") : null,
      ].filter(Boolean)),
      result,
    ]);
  }

  function drawConnections() {
    content.replaceChildren(el("div", { class: "psa-grid" }, [connectionCard("psa"), connectionCard("taskbar"),
      el("div", { class: "card psa-form" }, [el("div", { class: "title", text: "Use these tools in Kairos chat" }),
        el("div", { class: "meta", text: "Add a local MCP server in Tool Store with command python and this tab's mcp_bridge.py. Give the API addresses as --psa-url and --taskbar-url, and paste both keys, separated by a space, as the server's key. The tab README has the exact steps." })]),
    ]));
  }

  function draw() {
    if (disposed) return;
    drawTabs();
    if (mode === "connections") drawConnections();
    else if (mode === "actions") drawActions();
    else drawOverview();
  }

  async function openChat() {
    closeChat(); closeChat = () => {};
    const { session_id } = await api(BASE + "/chat", { method: "POST" });
    if (disposed) return;
    chatHost.hidden = false;
    chatHost.replaceChildren();
    const host = el("div", { class: "psa-chat-host" });
    chatHost.append(el("div", { class: "psa-column-head" }, [el("div", { class: "title", text: "Ask Kairos" }),
      button("Close", () => { closeChat(); closeChat = () => {}; chatHost.hidden = true; }, "quiet")]), host);
    closeChat = await mountSessionChat(host, { sessionId: session_id, title: "PSA Command", modelPicker: true,
      openInChats: true, placeholder: "Ask about the pipeline, overdue work or what to do next" });
    chatHost.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  actions.append(button("Refresh", () => load(true)), button("Ask Kairos", openChat, "primary"));
  await load(false);
  return () => { disposed = true; closeChat(); };
}
