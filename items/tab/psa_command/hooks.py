"""Background refresh while the tab is on, and Home cards from the cached overview."""
import asyncio
import logging
from datetime import datetime, timezone

from core import tab_api
from .service import psa_service

api = tab_api.for_tab(__package__)
log = logging.getLogger(__name__)
REFRESH_SECONDS = 15 * 60
_task = None


async def _loop():
    while True:
        await asyncio.sleep(REFRESH_SECONDS)
        if not api.is_on:
            continue
        try:
            await psa_service.refresh_all()
        except Exception:
            log.warning("PSA Command background refresh failed")


async def start():
    global _task
    api.register_sync("PSA Command", psa_service.refresh_all)
    if _task is None or _task.done():
        _task = asyncio.get_running_loop().create_task(_loop())


async def stop():
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):
            pass
        _task = None


def _when(value, now):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return "No due date"
    moment = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    days = (now - moment).days
    return "Overdue today" if days < 1 else f"{days} day{'s' if days != 1 else ''} overdue"


def home_cards(user):
    snapshot = psa_service.snapshot(user)
    if not snapshot:
        return [{"id": "overdue", "title": "Overdue sales tasks", "kind": "list", "rows": [],
                 "empty_text": "Open PSA Command to connect PSA Sales and Taskbar."}]
    now = datetime.now(timezone.utc)
    psa, taskbar = snapshot.get("psa") or {}, snapshot.get("taskbar") or {}
    rows = [("PSA", task) for task in psa.get("overdue_tasks") or []]
    rows += [("Taskbar", task) for task in taskbar.get("overdue_tasks") or []]
    rows.sort(key=lambda item: str(item[1].get("due_at") or ""))
    cards = [{"id": "overdue", "title": "Overdue sales tasks", "kind": "list",
              "rows": [{"title": str(task.get("title") or "Untitled task")[:80],
                        "meta": " · ".join(filter(None, (_when(task.get("due_at"), now), task.get("owner"))))[:80],
                        "badge": source, "tone": "danger"} for source, task in rows[:5]],
              "empty_text": "No overdue PSA or Taskbar tasks."}]
    if psa.get("closes_this_month") is not None:
        cards.append({"id": "closes", "title": "Closes this month", "kind": "stat",
                      "value": psa["closes_this_month"], "label": "new clients",
                      "detail": f"{(psa.get('totals') or {}).get('schools') or 0} schools in PSA Sales"[:80]})
    else:
        total = (psa.get("overdue_total") or 0) + (taskbar.get("overdue_total") or 0)
        cards.append({"id": "closes", "title": "Overdue across systems", "kind": "stat", "value": total,
                      "label": "overdue tasks", "detail": "PSA Sales and Taskbar"})
    return cards
