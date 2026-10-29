"""PSA Command state: per-user connections and the cached combined overview.

Connections are stored per Kairos user in ``connections.json`` with each API
key encrypted by this tab's own key (``api.encrypt``); plaintext keys never go
back to the view or into logs. ``snapshot.json`` keeps the last overview so
Home cards read locally without network calls.
"""
import asyncio
import json
import threading

from core import tab_api
from core.tab_api import wrap_untrusted
from . import catalog

api = tab_api.for_tab(__package__)
SYSTEMS = ("psa", "taskbar")
SNAPSHOT_LIMIT = 200_000


class PSACommandService:
    def __init__(self):
        self._lock = threading.Lock()
        # Tests swap this for a synthetic transport; production uses urllib.
        self.transport = None

    # -- connections -------------------------------------------------------------

    def _all(self):
        return api.read_json("connections.json", {})

    def users(self):
        return [user for user, saved in self._all().items() if any(saved.get(s, {}).get("key") for s in SYSTEMS)]

    def settings(self, user):
        saved = self._all().get(user, {})
        return {system: {"url": saved.get(system, {}).get("url", ""),
                         "key_saved": bool(saved.get(system, {}).get("key"))} for system in SYSTEMS}

    def save_settings(self, user, system, url=None, key=None, clear=False):
        if system not in SYSTEMS:
            raise ValueError("Unknown connection")
        with self._lock:
            data = self._all()
            entry = data.setdefault(user, {})
            if clear:
                entry.pop(system, None)
            else:
                current = entry.get(system, {})
                if url is not None:
                    current["url"] = catalog.check_base_url(url, system)
                if key:
                    current["key"] = api.encrypt(catalog.check_key(key, system))
                if not current.get("url") or not current.get("key"):
                    raise ValueError(f"Enter both the {catalog.LABELS[system]} API address and a key")
                entry[system] = current
            api.write_json("connections.json", data)
        return self.settings(user)

    def connections(self, user):
        saved = self._all().get(user, {})
        result = {}
        for system in SYSTEMS:
            entry = saved.get(system) or {}
            if entry.get("url") and entry.get("key"):
                result[system] = catalog.Connection(system, entry["url"], api.decrypt(entry["key"]),
                                                    transport=self.transport)
            else:
                result[system] = None
        return result

    # -- overview and actions ------------------------------------------------------

    def snapshot(self, user):
        return api.read_json("snapshot.json", {}).get(user)

    async def refresh(self, user):
        connections = self.connections(user)
        data = await asyncio.to_thread(catalog.overview, connections)
        if len(json.dumps(data)) <= SNAPSHOT_LIMIT:
            with self._lock:
                snapshots = api.read_json("snapshot.json", {})
                snapshots[user] = data
                api.write_json("snapshot.json", snapshots)
        return data

    async def refresh_all(self):
        refreshed = 0
        for user in self.users():
            if not api.is_on:
                break
            await self.refresh(user)
            refreshed += 1
        return {"refreshed": refreshed}

    async def run_tool(self, user, name, args):
        connections = self.connections(user)
        result = await asyncio.to_thread(catalog.call_tool, name, args, connections)
        tool = catalog.BY_NAME[name]
        if tool["write"] and not (isinstance(result, dict) and result.get("confirmation_required")):
            try:
                await self.refresh(user)
            except Exception:
                pass  # the write succeeded; the next refresh catches up
        return result

    async def test(self, user, system):
        connection = self.connections(user).get(system)
        if connection is None:
            raise ValueError(f"{catalog.LABELS[system]} is not connected")
        me = await asyncio.to_thread(connection.request, "GET", "/me")
        name = me.get("name") or (me.get("user") or {}).get("name") or me.get("email") or "connected user"
        return {"ok": True, "name": str(name)[:80], "role": str(me.get("role") or "")[:40]}

    # -- chat ------------------------------------------------------------------

    def brief_chat(self, user):
        """Open this user's PSA Command chat and add the latest overview as
        untrusted context, without spending a model turn."""
        session_id = api.chat_session(f"psa:{user}", "PSA Command", untrusted="PSA Sales and Taskbar records")
        snapshot = self.snapshot(user)
        if snapshot:
            api.append_chat_message(session_id, "user",
                "Context from my PSA Command tab, refreshed " + str(snapshot.get("generated_at", ""))[:19]
                + ". Help me run PSA Sales and Taskbar together. Ask me before any change.\n\n"
                + wrap_untrusted("PSA Sales and Taskbar overview", json.dumps(snapshot, ensure_ascii=False)[:60000]))
        return session_id


psa_service = PSACommandService()
