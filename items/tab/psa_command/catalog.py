"""PSA Sales + Taskbar operations shared by the tab and its MCP bridge.

Standard library only and no Kairos imports, so mcp_bridge.py can run it as a
plain script. Every request goes to a fixed path on a base URL the person
saved; tools never accept a destination URL, keys only travel in the
Authorization header, and redirects are refused.

Writes are two-step. A write tool called without ``confirm: true`` returns a
plain-language preview and changes nothing; the caller shows it to the person
and repeats the call with ``confirm: true`` only after they agree.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TIMEOUT_SECONDS = 30
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
KEY_PATTERNS = {"psa": re.compile(r"^psak_[0-9a-f]{64}$"), "taskbar": re.compile(r"^tbk_[0-9a-f]{64}$")}
PATH_PATTERNS = {
    "psa": re.compile(r"^/(me|team|pipeline|accounts|commissions|outreach(?:/\d+)?|tasks(?:/\d+)?"
                      r"|schools(?:/assign|/\d+(?:/activities)?)?)$"),
    "taskbar": re.compile(r"^/(me|programs|members|tasks(?:/[0-9a-f-]{36})?)$"),
}
LABELS = {"psa": "PSA Sales", "taskbar": "Taskbar"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ApiError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def check_base_url(url, system):
    """Normalize a saved API base URL or raise ValueError."""
    if not isinstance(url, str) or not url.strip():
        raise ValueError(f"Enter the {LABELS[system]} API address")
    parsed = urllib.parse.urlsplit(url.strip())
    secure = parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in LOCAL_HOSTS)
    if not secure or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"The {LABELS[system]} API address must be an https:// base URL")
    return url.strip().rstrip("/")


def check_key(key, system):
    if not isinstance(key, str) or not KEY_PATTERNS[system].match(key.strip()):
        prefix = "psak_" if system == "psa" else "tbk_"
        raise ValueError(f"Paste a {LABELS[system]} API key starting with {prefix}")
    return key.strip()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ApiError("The API tried to redirect; request refused")


_opener = urllib.request.build_opener(_NoRedirect)


def urllib_transport(method, url, headers, body):
    """Return (status, parsed JSON). Tests replace this; nothing else does network."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with _opener.open(req, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(2_000_000)
            return response.status, json.loads(raw or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read(65536) or b"{}")
        except ValueError:
            return error.code, {}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ApiError("Could not reach the API") from error


class Connection:
    def __init__(self, system, base_url, key, transport=None):
        self.system = system
        self.base_url = check_base_url(base_url, system)
        self._key = check_key(key, system)
        self._transport = transport or urllib_transport

    def __repr__(self):  # never show the key
        return f"Connection({self.system!r}, {self.base_url!r})"

    def request(self, method, path, params=None, body=None):
        if not PATH_PATTERNS[self.system].match(path):
            raise ApiError("Invalid API path")
        url = self.base_url + path
        if params:
            query = {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in params.items() if v is not None}
            if query:
                url += "?" + urllib.parse.urlencode(query)
        headers = {"Authorization": "Bearer " + self._key, "Accept": "application/json"}
        if method != "GET":
            headers["Content-Type"] = "application/json"
        status, data = self._transport(method, url, headers, body if method != "GET" else None)
        if status >= 400:
            message = data.get("error") if isinstance(data, dict) else None
            raise ApiError(f"{LABELS[self.system]} {status}: {str(message or 'Request failed')[:300]}", status)
        return data


# -- Tool catalog --------------------------------------------------------------

S = {"type": "string"}
ID = {"type": "integer", "minimum": 1}
TB_ID = {"type": "string", "format": "uuid"}
DATE_TIME = {"type": "string", "format": "date-time", "description": "ISO 8601 with UTC offset"}
DAY = {"type": "string", "format": "date"}
SCOPE = {"enum": ["mine", "team"]}
STAGE = {"enum": ["pending", "contacted", "replied", "meeting", "partner", "former", "not_interested"]}
TB_STATUS = {"enum": ["Not Started", "In Progress", "Completed"]}
TB_FIELDS = {"title": {"type": "string", "minLength": 1, "maxLength": 140},
             "description": {"type": "string", "maxLength": 20000}, "program_id": TB_ID,
             "due_at": DATE_TIME, "priority": {"enum": ["High", "Medium", "Low"]}, "status": TB_STATUS,
             "assignee": {"anyOf": [TB_ID, {"type": "null"}]}}


def _tool(name, system, method, path, description, properties=None, required=(), write=False, summary=None):
    return {"name": name, "system": system, "method": method, "path": path, "description": description,
            "properties": properties or {}, "required": list(required), "write": write, "summary": summary}


TOOLS = [
    _tool("sales_overview", "both", None, None,
          "One combined view across PSA Sales and Taskbar: pipeline by rep, overdue sales and Taskbar tasks, "
          "recent sales activity and closes this month."),
    _tool("psa_connection", "psa", "GET", "/me", "Who the PSA Sales key belongs to, their role and key expiry."),
    _tool("psa_pipeline", "psa", "GET", "/pipeline", "PSA pipeline summary, open and overdue tasks, recent activity.",
          {"scope": SCOPE, "today": DAY}),
    _tool("psa_team", "psa", "GET", "/team", "Administrators: reps with school, reply and overdue counts and user IDs."),
    _tool("psa_accounts", "psa", "GET", "/accounts", "Administrators: closed-won accounts and pipeline counts by rep."),
    _tool("psa_commissions", "psa", "GET", "/commissions", "Administrators: seasonal program commission totals by rep and season. Filter by season name or rep user ID.",
          {"season": S, "rep_id": ID}),
    _tool("psa_schools", "psa", "GET", "/schools",
          "Search PSA schools by text, stage (comma list), owner user ID, type or due (overdue, today, none).",
          {"q": S, "stage": S, "owner": ID, "type": {"enum": ["preschool", "elementary", "private"]},
           "due": {"enum": ["overdue", "today", "none"]}, "sort": {"enum": ["name", "newest", "due", "closed"]},
           "scope": SCOPE, "page": ID, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}),
    _tool("psa_school", "psa", "GET", "/schools/{school_id}", "Read one PSA school and its timeline.",
          {"school_id": ID}, ["school_id"]),
    _tool("psa_tasks", "psa", "GET", "/tasks", "List PSA sales tasks: view open, today, overdue, upcoming or completed.",
          {"view": {"enum": ["open", "today", "overdue", "upcoming", "completed"]}, "school_id": ID, "scope": SCOPE,
           "today": DAY, "page": ID, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}),
    _tool("psa_outreach", "psa", "GET", "/outreach", "Recent PSA outreach batches. Read-only; never sends email.",
          {"limit": {"type": "integer", "minimum": 1, "maximum": 50}, "scope": SCOPE}),
    _tool("psa_create_task", "psa", "POST", "/tasks", "Create a PSA sales task. Admins may assign user_id.",
          {"title": {"type": "string", "minLength": 1, "maxLength": 240}, "user_id": ID, "school_id": ID,
           "due_at": DATE_TIME, "priority": {"enum": ["normal", "high"]}}, ["title"], True,
          lambda a: f"Create PSA Sales task \"{a['title']}\"" + (f" due {a['due_at']}" if a.get("due_at") else "")
          + (f" for user {a['user_id']}" if a.get("user_id") else "") + (f" on school {a['school_id']}" if a.get("school_id") else "")),
    _tool("psa_update_task", "psa", "PATCH", "/tasks/{task_id}",
          "Complete, reopen or reschedule a PSA task with its latest version (409 means it changed: re-read first).",
          {"task_id": ID, "version": {"type": "integer", "minimum": 1}, "status": {"enum": ["open", "completed"]},
           "due_at": {"anyOf": [DATE_TIME, {"type": "null"}]}}, ["task_id", "version"], True,
          lambda a: f"Update PSA Sales task {a['task_id']}: " + ", ".join(
              f"{k} to {a[k]}" for k in ("status", "due_at") if k in a)),
    _tool("psa_update_school", "psa", "PATCH", "/schools/{school_id}",
          "Change a PSA school's stage, next action and date, or owner (owner is admin only).",
          {"school_id": ID, "status": STAGE, "next_action": {"anyOf": [{"type": "string", "maxLength": 500}, {"type": "null"}]},
           "next_action_at": {"anyOf": [DATE_TIME, {"type": "null"}]}, "user_id": ID}, ["school_id"], True,
          lambda a: f"Update PSA Sales school {a['school_id']}: " + ", ".join(
              f"{k.replace('_', ' ')} to {a[k]}" for k in ("status", "next_action", "next_action_at", "user_id") if k in a)),
    _tool("psa_assign_schools", "psa", "POST", "/schools/assign",
          "Administrators: reassign up to 100 PSA schools to one rep; open tasks move with them.",
          {"ids": {"type": "array", "items": ID, "minItems": 1, "maxItems": 100}, "user_id": ID}, ["ids", "user_id"], True,
          lambda a: f"Reassign {len(a['ids'])} PSA Sales school(s) ({', '.join(map(str, a['ids'][:10]))}) to user {a['user_id']}"),
    _tool("psa_log_activity", "psa", "POST", "/schools/{school_id}/activities", "Log a call, meeting or note on a PSA school.",
          {"school_id": ID, "kind": {"enum": ["call", "meeting", "note"]}, "detail": {"type": "string", "minLength": 1, "maxLength": 2000}},
          ["school_id", "kind", "detail"], True,
          lambda a: f"Log a {a['kind']} on PSA Sales school {a['school_id']}: \"{a['detail'][:120]}\""),
    _tool("taskbar_connection", "taskbar", "GET", "/me", "Who the Taskbar key belongs to, workspace, role and expiry."),
    _tool("taskbar_programs", "taskbar", "GET", "/programs", "Taskbar programs available to this key (IDs for new tasks)."),
    _tool("taskbar_members", "taskbar", "GET", "/members", "Taskbar teammates and user IDs for assignments."),
    _tool("taskbar_tasks", "taskbar", "GET", "/tasks", "Find Taskbar tasks by text, program, assignee, status or due range.",
          {"q": S, "program_id": TB_ID, "assignee": TB_ID, "status": TB_STATUS, "due_before": DATE_TIME,
           "due_after": DATE_TIME, "limit": {"type": "integer", "minimum": 1, "maximum": 100},
           "offset": {"type": "integer", "minimum": 0}}),
    _tool("taskbar_task", "taskbar", "GET", "/tasks/{task_id}", "Read one Taskbar task and its revision.",
          {"task_id": TB_ID}, ["task_id"]),
    _tool("taskbar_create_task", "taskbar", "POST", "/tasks", "Create a Taskbar task with a program and deadline.",
          TB_FIELDS, ["title", "program_id", "due_at"], True,
          lambda a: f"Create Taskbar task \"{a['title']}\" due {a['due_at']} in program {a['program_id']}"
          + (f" for {a['assignee']}" if a.get("assignee") else "")),
    _tool("taskbar_update_task", "taskbar", "PATCH", "/tasks/{task_id}",
          "Update a Taskbar task with its latest revision (409 means it changed: re-read first).",
          {"task_id": TB_ID, "revision": {"type": "integer", "minimum": 1}, **TB_FIELDS}, ["task_id", "revision"], True,
          lambda a: f"Update Taskbar task {a['task_id']}: " + ", ".join(
              f"{k} to {a[k]}" for k in TB_FIELDS if k in a)),
]
BY_NAME = {tool["name"]: tool for tool in TOOLS}


def input_schema(tool):
    properties = dict(tool["properties"])
    if tool["write"]:
        properties["confirm"] = {"type": "boolean", "description": "true only after the person approved the preview"}
    return {"type": "object", "properties": properties, "required": tool["required"], "additionalProperties": False}


def _valid(schema, value):
    if "anyOf" in schema:
        return any(_valid(option, value) for option in schema["anyOf"])
    if "enum" in schema:
        return value in schema["enum"]
    kind = schema.get("type")
    if kind == "null":
        return value is None
    if kind == "integer":
        return type(value) is int and value >= schema.get("minimum", value) and value <= schema.get("maximum", value)
    if kind == "boolean":
        return type(value) is bool
    if kind == "array":
        return (isinstance(value, list) and schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", len(value))
                and all(_valid(schema["items"], item) for item in value))
    if kind == "string":
        if not isinstance(value, str) or len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 20000):
            return False
        if schema.get("format") == "uuid":
            return bool(UUID.match(value))
        if schema.get("format") in ("date-time", "date"):
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return False
        return True
    return False


def validate(tool, args):
    if not isinstance(args, dict):
        raise ValueError("Tool arguments must be an object")
    allowed = set(tool["properties"]) | ({"confirm"} if tool["write"] else set())
    unknown = set(args) - allowed
    if unknown:
        raise ValueError("Unknown argument: " + ", ".join(sorted(unknown)))
    missing = [name for name in tool["required"] if name not in args]
    if missing:
        raise ValueError("Missing argument: " + ", ".join(missing))
    for name, value in args.items():
        schema = {"type": "boolean"} if name == "confirm" else tool["properties"][name]
        if not _valid(schema, value):
            raise ValueError(f"Invalid value for {name}")


def call_tool(name, args, connections, now=None):
    """Run one catalog tool. ``connections`` maps 'psa'/'taskbar' to a Connection (or None)."""
    tool = BY_NAME.get(name)
    if tool is None:
        raise ValueError("Unknown tool")
    args = dict(args or {})
    validate(tool, args)
    if name == "sales_overview":
        return overview(connections, now=now)
    connection = connections.get(tool["system"])
    if connection is None:
        raise ValueError(f"{LABELS[tool['system']]} is not connected in PSA Command")
    confirmed = args.pop("confirm", False)
    if tool["write"] and confirmed is not True:
        return {"confirmation_required": True, "system": LABELS[tool["system"]], "summary": tool["summary"](args),
                "next_step": "Show this summary to the person. Call again with confirm true only if they approve."}
    path = tool["path"]
    for key in ("school_id", "task_id"):
        if "{" + key + "}" in path:
            path = path.replace("{" + key + "}", str(args.pop(key)))
    if tool["method"] == "GET":
        return connection.request("GET", path, params=args)
    return connection.request(tool["method"], path, body=args)


# -- Combined overview -------------------------------------------------------------

def _text(value, limit=160):
    return str(value)[:limit] if value is not None else None


def _member_name(member):
    for key in ("name", "full_name", "display_name", "email"):
        if isinstance(member, dict) and member.get(key):
            return _text(member[key], 80)
    return None


def _parse_time(value):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _psa_overview(conn, now):
    me = conn.request("GET", "/me")
    today = now.date().isoformat()
    pipeline = conn.request("GET", "/pipeline", params={"today": today})
    overdue = conn.request("GET", "/tasks", params={"view": "overdue", "limit": 50, "today": today})
    result = {
        "connected": True, "me": {"name": _text(me.get("name"), 80), "role": me.get("role")},
        "admin": bool(me.get("admin")),
        "totals": {k: pipeline.get(k) for k in ("schools", "sent", "responses", "response_rate",
                                                 "due_followups", "tasks_open", "tasks_overdue")},
        "stages": pipeline.get("pipeline") or {},
        "overdue_tasks": [{
            "id": row.get("id"), "title": _text(row.get("title")), "owner": _text(row.get("owner_name"), 80),
            "user_id": row.get("user_id"), "school": _text(row.get("school_name"), 120),
            "school_id": row.get("school_id"), "due_at": row.get("due_at"), "version": row.get("version"),
            "priority": row.get("priority"),
        } for row in (overdue.get("items") or [])],
        "overdue_total": overdue.get("total", 0),
        "activity": [{"kind": row.get("kind"), "detail": _text(row.get("detail"), 240), "at": row.get("at"),
                      "school": _text(row.get("school_name"), 120), "school_id": row.get("school_id"),
                      "actor": _text(row.get("actor"), 80)} for row in (pipeline.get("activity") or [])],
        "reps": [], "closes_this_month": None,
    }
    if result["admin"]:
        team = conn.request("GET", "/team", params={"today": today})
        accounts = conn.request("GET", "/accounts")
        by_rep = {rep.get("id"): rep for rep in accounts.get("reps") or []}
        month = (now.year, now.month)
        closes = 0
        for member in team if isinstance(team, list) else []:
            rep = by_rep.get(member.get("id"), {})
            counts = rep.get("counts") or {}
            month_closes = sum(1 for account in rep.get("accounts") or []
                               if (moment := _parse_time(account.get("closed_at"))) and (moment.year, moment.month) == month)
            closes += month_closes
            result["reps"].append({
                "id": member.get("id"), "name": _text(member.get("name"), 80), "role": member.get("role"),
                "schools": member.get("schools", 0), "pipeline": counts.get("pipeline", 0),
                "active_clients": counts.get("active", 0), "closes_this_month": month_closes,
                "closed_last_90": rep.get("closed_last_90", 0), "overdue_tasks": member.get("overdue", 0),
                "sent": member.get("sent", 0), "responses": member.get("responses", 0),
            })
        result["closes_this_month"] = closes
    return result


def _taskbar_overview(conn, now):
    me = conn.request("GET", "/me")
    members = conn.request("GET", "/members")
    names = {m.get("id"): _member_name(m) for m in (members if isinstance(members, list) else members.get("items") or [])
             if isinstance(m, dict)}
    rows, offset = [], 0
    while offset < 300:
        page = conn.request("GET", "/tasks", params={"due_before": now.isoformat(), "limit": 100, "offset": offset})
        items = page.get("items") or []
        rows.extend(items)
        if len(items) < 100:
            break
        offset += 100
    seen, overdue = set(), []
    for row in rows:
        if row.get("id") in seen or row.get("status") == "Completed":
            continue
        seen.add(row.get("id"))
        overdue.append({"id": row.get("id"), "title": _text(row.get("title")), "due_at": row.get("due_at"),
                        "status": row.get("status"), "priority": row.get("priority"), "revision": row.get("revision"),
                        "assignee": row.get("assignee"), "owner": names.get(row.get("assignee")),
                        "program_id": row.get("program_id")})
    overdue.sort(key=lambda row: (row["due_at"] or "", str(row["id"])))
    workspace = me.get("workspace") if isinstance(me.get("workspace"), dict) else {}
    return {"connected": True, "me": {"name": _text(me.get("name") or (me.get("user") or {}).get("name"), 80),
                                      "role": _text(me.get("role"), 40), "workspace": _text(workspace.get("name"), 80)},
            "overdue_tasks": overdue[:50], "overdue_total": len(overdue)}


def overview(connections, now=None):
    now = now or datetime.now(timezone.utc)
    result = {"generated_at": now.isoformat()}
    for system, build in (("psa", _psa_overview), ("taskbar", _taskbar_overview)):
        conn = connections.get(system)
        if conn is None:
            result[system] = {"connected": False}
            continue
        try:
            result[system] = build(conn, now)
        except (ApiError, ValueError, AttributeError, TypeError) as error:
            message = str(error) if isinstance(error, ApiError) else "Unexpected response"
            result[system] = {"connected": True, "error": message}
    return result
