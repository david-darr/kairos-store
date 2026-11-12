"""PSA Command routes: connections, the combined overview and confirmed actions."""
import os
import sys
import asyncio
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import tab_api
from core.tab_api import require_user
from . import catalog
from .service import psa_service

api = tab_api.for_tab(__package__)
router = APIRouter(prefix="/api/tab-psa-command", tags=["psa"])


class SignInRequest(BaseModel):
    url: str
    email: str
    password: str
    capabilities: list[str] = []
    scope: str = 'read'
    days: int = 30
    confirm_send: bool = False
    create_key: bool = True


class HumanRequest(BaseModel):
    method: str = 'GET'
    path: str
    body: Optional[dict] = None
    params: Optional[dict] = None


class UploadRequest(BaseModel):
    kind: str
    filename: str
    encoded: str
    workspace: str = "school"


@router.post('/human-upload')
async def human_upload(body: UploadRequest,user: str = Depends(require_user)):
    try:return await asyncio.to_thread(psa_service.human.upload,user,body.kind,body.filename,body.encoded,body.workspace)
    except ValueError as error:raise HTTPException(status_code=400,detail=str(error))
    except catalog.ApiError as error:raise HTTPException(status_code=error.status if error.status in (400,401,403,409,413) else 502,detail=str(error))


@router.get('/human-session')
async def human_status(user: str = Depends(require_user)):
    return psa_service.human.status(user)


@router.post('/human-session')
async def human_sign_in(body: SignInRequest,user: str = Depends(require_user)):
    try:
        return await asyncio.to_thread(psa_service.human.connect,user,body.url,body.email,body.password,
            body.capabilities,body.scope,body.days,body.confirm_send,body.create_key)
    except (ValueError,catalog.ApiError) as error:
        raise HTTPException(status_code=400,detail=str(error))


@router.delete('/human-session')
async def human_sign_out(user: str = Depends(require_user)):
    return psa_service.human.disconnect(user)


@router.post('/human-session/revoke')
async def human_revoke(user: str = Depends(require_user)):
    try:return await asyncio.to_thread(psa_service.human.revoke_connection,user)
    except catalog.ApiError as error:
        raise HTTPException(status_code=error.status if error.status in (400,401,403,404,409) else 502,detail=str(error))


@router.post('/human-request')
async def human_request(body: HumanRequest,user: str = Depends(require_user)):
    # UI only. This broker is deliberately absent from catalog.py and MCP tools.
    try:
        return await asyncio.to_thread(psa_service.human.request,user,body.method,body.path,body.body,body.params)
    except ValueError as error:raise HTTPException(status_code=400,detail=str(error))
    except catalog.ApiError as error:raise HTTPException(status_code=error.status if error.status in (400,401,403,404,409,429) else 502,detail=str(error))


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
async def get_overview(refresh: bool = False, workspace: str = "school", user: str = Depends(require_user)) -> dict:
    if workspace not in ("school","business"):raise HTTPException(status_code=400,detail="Choose school or business workspace")
    snapshot = psa_service.snapshot(user,workspace)
    if refresh or snapshot is None:
        snapshot = await psa_service.refresh(user,workspace)
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


@router.get("/chat-tools")
async def chat_tools(user: str = Depends(require_user)) -> dict:
    """How to start mcp_bridge.py from this install, using the saved addresses.
    Keys are not included; the person pastes them into the Kairos server."""
    saved = psa_service.settings(user)
    args = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp_bridge.py")]
    for system in ("psa", "taskbar"):
        if saved[system]["url"]:
            args += [f"--{system}-url", saved[system]["url"]]
    return {"name": "PSA Command", "command": sys.executable, "args": args,
            "systems": [system for system in ("psa", "taskbar") if saved[system]["url"]]}


@router.post("/chat")
async def open_chat(workspace: str = "school", user: str = Depends(require_user)) -> dict:
    if workspace not in ("school","business"):raise HTTPException(status_code=400,detail="Choose school or business workspace")
    return {"session_id": psa_service.brief_chat(user,workspace)}
