"""PSA Command routes: connections, the combined overview and confirmed actions."""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import tab_api
from core.tab_api import require_user
from . import catalog
from .service import psa_service

api = tab_api.for_tab(__package__)
router = APIRouter(prefix="/api/tab-psa-command", tags=["psa"])


class ConnectionRequest(BaseModel):
    url: Optional[str] = None
    key: Optional[str] = None
    clear: bool = False


class ActionRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = {}
    confirmed: bool = False


def _system(system):
    if system not in catalog.LABELS:
        raise HTTPException(status_code=404, detail="Unknown connection")
    return system


@router.get("/settings")
async def get_settings(user: str = Depends(require_user)) -> dict:
    return psa_service.settings(user)


@router.put("/settings/{system}")
async def save_settings(system: str, body: ConnectionRequest, user: str = Depends(require_user)) -> dict:
    try:
        return psa_service.save_settings(user, _system(system), body.url, body.key, body.clear)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.post("/settings/{system}/test")
async def test_connection(system: str, user: str = Depends(require_user)) -> dict:
    try:
        return await psa_service.test(user, _system(system))
    except (ValueError, catalog.ApiError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/overview")
async def get_overview(refresh: bool = False, user: str = Depends(require_user)) -> dict:
    snapshot = psa_service.snapshot(user)
    if refresh or snapshot is None:
        snapshot = await psa_service.refresh(user)
    return snapshot


@router.get("/tools")
async def list_tools(user: str = Depends(require_user)) -> list[dict]:
    return [{"name": t["name"], "system": t["system"], "description": t["description"], "write": t["write"],
             "input_schema": catalog.input_schema(t)} for t in catalog.TOOLS]


@router.post("/action")
async def run_action(body: ActionRequest, user: str = Depends(require_user)) -> dict:
    """Run one catalog tool for this user. Writes need ``confirmed`` from the
    view's confirmation dialog; without it the preview is returned."""
    tool = catalog.BY_NAME.get(body.tool)
    if tool is None:
        raise HTTPException(status_code=404, detail="Unknown action")
    arguments = {k: v for k, v in body.arguments.items() if k != "confirm"}
    if tool["write"] and body.confirmed:
        arguments["confirm"] = True
    try:
        return {"result": await psa_service.run_tool(user, body.tool, arguments)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except catalog.ApiError as error:
        status = error.status if error.status in (400, 403, 404, 409, 429) else 502
        raise HTTPException(status_code=status, detail=str(error))


@router.post("/chat")
async def open_chat(user: str = Depends(require_user)) -> dict:
    return {"session_id": psa_service.brief_chat(user)}
