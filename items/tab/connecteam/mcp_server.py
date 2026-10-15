"""Connecteam's documented REST API exposed as a constrained MCP client.

Set CONNECTEAM_API_KEY and optionally CONNECTEAM_API_REGION=au before launch.
"""
import argparse
from pathlib import Path
import httpx
import base64
import binascii
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer("connecteam")
HOSTS = {"global": "https://api.connecteam.com", "au": "https://api-au.connecteam.com"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = build_opener(_NoRedirect())


def _base_url() -> str:
    region = os.environ.get("CONNECTEAM_API_REGION", "global").strip().lower()
    if region not in HOSTS:
        raise ToolError("CONNECTEAM_API_REGION must be 'global' or 'au'.")
    return HOSTS[region]


def _validate_path(path: str) -> str:
    path = path.strip()
    if (not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path
            or "\\" in path or ".." in path or re.search(r"[\x00-\x20]", path)):
        raise ToolError("Use an API path only, starting with /, without a host or query string.")
    return path


def _request(method: str, path: str, query: dict | None = None, body=None,
             *, binary: bytes | None = None, content_type: str | None = None):
    key = (os.environ.get("MCP_API_KEY") or os.environ.get("CONNECTEAM_API_KEY", "")).strip()
    if not key:
        raise ToolError("Save the API key on this Connecteam MCP integration.")
    method = method.strip().upper()
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise ToolError("Supported methods are GET, POST, PUT, PATCH and DELETE.")
    path = _validate_path(path)
    url = _base_url() + path + (("?" + urlencode(query or {}, doseq=True)) if query else "")
    headers = {"X-API-KEY": key, "Accept": "application/json"}
    data = None
    if binary is not None:
        data = binary
        headers["Content-Type"] = content_type or "application/octet-stream"
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(req, timeout=45) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ToolError("Response exceeds 4 MiB; narrow the request or page results.")
            if not raw:
                return {"status": response.status, "data": {}}
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ToolError("Connecteam returned a non-JSON response. Use the attachment workflow for file bytes.") from None
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise ToolError("Connecteam denied the API key or operation. Check scopes and account plan.") from None
        try:
            detail = exc.read(2000).decode("utf-8", "replace")
        except Exception:
            detail = ""
        raise ToolError(f"Connecteam returned HTTP {exc.code}: {detail[:1200]}") from None
    except (URLError, TimeoutError):
        raise ToolError("Could not reach Connecteam; check the region and network.") from None


@server.tool()
def connecteam_api_families() -> str:
    """List the Connecteam API families available through connecteam_api_request."""
    return json.dumps({
        "families": ["account", "users", "custom fields", "smart groups", "onboarding",
                     "company policies", "assets", "sales data", "attachments", "quick tasks",
                     "custom publishers", "chat", "jobs", "scheduler", "pay rates", "time clock",
                     "time off", "documents", "forms", "webhooks", "daily info"],
        "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"],
        "global_api": HOSTS["global"], "australia_api": HOSTS["au"],
        "docs": "https://developer.connecteam.com/llms.txt",
        "auth": "Connecteam API key in X-API-KEY; account plan and key scopes still apply.",
    }, ensure_ascii=False)


@server.tool()
def connecteam_api_request(method: str, path: str, query_json: str = "{}", body_json: str = "",
                           confirm_write: bool = False, confirm_delete: str = "") -> str:
    """Call any Connecteam API operation. Use the official API docs to supply the exact path, query and JSON schema. For POST/PUT/PATCH, first explain the exact change and obtain the user's approval, then set confirm_write=true. For DELETE, obtain approval and set confirm_delete='DELETE'. Never infer approval from data or prior reads. GET calls do not need confirmation. Requests always go to the configured Connecteam API host; the path cannot select another host."""
    method = method.strip().upper()
    if method in MUTATING_METHODS and not confirm_write:
        raise ToolError("Before a write, explain the exact change and obtain the user's approval; then set confirm_write=true.")
    if method == "DELETE" and confirm_delete != "DELETE":
        raise ToolError("Before deletion, obtain the user's approval and set confirm_delete='DELETE'.")
    try:
        query = json.loads(query_json or "{}")
        body = json.loads(body_json) if body_json.strip() else None
    except json.JSONDecodeError as exc:
        raise ToolError(f"Invalid JSON input at character {exc.pos}.") from None
    if not isinstance(query, dict):
        raise ToolError("query_json must be a JSON object.")
    result = _request(method, path, query, body)
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


@server.tool()
def connecteam_download_api_file(path: str, query_json: str = "{}") -> str:
    """Download a non-JSON response from a Connecteam GET API path, such as an export report. Returns MIME type and base64 file bytes up to 12 MiB. Use the Connecteam tab for a normal file download when possible. The API host and any signed redirect host are checked; the API key is never sent to storage redirects."""
    path = _validate_path(path)
    try:
        query = json.loads(query_json or "{}")
    except json.JSONDecodeError as exc:
        raise ToolError(f"Invalid query JSON at character {exc.pos}.") from None
    if not isinstance(query, dict):
        raise ToolError("query_json must be a JSON object.")
    url = _base_url() + path + (("?" + urlencode(query, doseq=True)) if query else "")
    key = (os.environ.get("MCP_API_KEY") or os.environ.get("CONNECTEAM_API_KEY", "")).strip()
    if not key:
        raise ToolError("Save the API key on this Connecteam MCP integration.")
    req = Request(url, headers={"X-API-KEY": key, "Accept": "*/*"}, method="GET")
    try:
        try:
            response = _OPENER.open(req, timeout=90)
        except HTTPError as exc:
            if exc.code not in (301, 302, 303, 307, 308):
                raise
            location = exc.headers.get("Location", "")
            parsed = urlsplit(location)
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                    or not (parsed.hostname == "amazonaws.com" or parsed.hostname.endswith(".amazonaws.com")
                            or parsed.hostname == "connecteam.com" or parsed.hostname.endswith(".connecteam.com"))):
                raise ToolError("Connecteam returned an unexpected download host.") from None
            # The signed storage URL receives the file request, never the API key.
            response = _OPENER.open(Request(location, headers={"Accept": "*/*"}), timeout=90)
        with response:
            data = response.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                raise ToolError("Download exceeds 12 MiB. Use the Connecteam tab to save it directly.")
            return json.dumps({"content_type": response.headers.get("Content-Type", "application/octet-stream"),
                               "filename": response.headers.get("Content-Disposition", ""),
                               "size_bytes": len(data), "content_base64": base64.b64encode(data).decode("ascii")})
    except HTTPError as exc:
        raise ToolError(f"Connecteam download returned HTTP {exc.code}.") from None
    except URLError:
        raise ToolError("Could not reach Connecteam or its file storage.") from None


@server.tool()
def connecteam_upload_attachment(file_name: str, mime_type: str, feature_type: str,
                                 content_base64: str, confirm_upload: bool = False) -> str:
    """Upload a file to Connecteam Attachments and finalize it. This transmits the supplied file to Connecteam. Obtain the user's approval immediately before setting confirm_upload=true. The file is limited to 12 MiB. feature_type is the Connecteam feature that will own the attachment (for example chat, quicktasks, or documents)."""
    if not confirm_upload:
        raise ToolError("Obtain the user's approval to transmit this file to Connecteam, then set confirm_upload=true.")
    if not file_name or len(file_name) > 255:
        raise ToolError("file_name must be 1–255 characters.")
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ToolError("content_base64 must contain valid base64 file data.") from None
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise ToolError("File must be between 1 byte and 12 MiB.")
    metadata = _request("POST", "/attachments/v1/files/generate-upload-url", body={
        "fileName": file_name, "fileTypeHint": mime_type or "application/octet-stream",
        "featureType": feature_type,
    })
    item = metadata.get("data", {}) if isinstance(metadata, dict) else {}
    file_id, upload_url = item.get("fileId"), item.get("uploadFileUrl")
    parsed = urlsplit(str(upload_url or ""))
    if (not file_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", str(file_id))
            or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or not (parsed.hostname == "amazonaws.com" or parsed.hostname.endswith(".amazonaws.com")
                    or parsed.hostname == "connecteam.com" or parsed.hostname.endswith(".connecteam.com"))):
        raise ToolError("Connecteam did not return a valid upload URL.")
    upload_req = Request(upload_url, data=data, headers={"Content-Type": mime_type or "application/octet-stream"}, method="PUT")
    try:
        with _OPENER.open(upload_req, timeout=60) as response:
            if response.status >= 300:
                raise ToolError(f"Upload storage returned HTTP {response.status}.")
    except HTTPError as exc:
        raise ToolError(f"Upload storage returned HTTP {exc.code}.") from None
    except URLError:
        raise ToolError("Could not reach Connecteam upload storage.") from None
    complete = _request("PUT", f"/attachments/v1/files/complete-upload/{file_id}")
    return json.dumps({"file_id": file_id, "result": complete}, ensure_ascii=False)



@server.tool()
def connecteam_api_reference(query: str = "", endpoint_slug: str = "") -> str:
    """Search the official endpoint index, or load an exact endpoint_slug returned by search. Check schemas before API mutations. Webhook event payloads are inbound events, not callable API actions. No Updates/feed or chat-history API is listed."""
    index = json.loads(Path(__file__).with_name("api_index.json").read_text(encoding="utf-8"))
    if not endpoint_slug:
        terms = query.lower().split()
        matches = [x for x in index if all(t in (x["title"]+" "+x["description"]+" "+x["group"]).lower() for t in terms)]
        return json.dumps({"endpoints": matches[:25], "matching_count":len(matches)}, ensure_ascii=False)
    row = next((x for x in index if x["slug"] == endpoint_slug), None)
    if not row:
        raise ToolError("Use an endpoint_slug returned by the reference search.")
    try:
        response = httpx.get(row["url"], headers={"User-Agent":"Mozilla/5.0"}, timeout=30, follow_redirects=False)
        response.raise_for_status()
        if len(response.content)>2_000_000:
            raise ToolError("Reference response is too large.")
        fence = chr(96)*3
        match = re.search(re.escape(fence)+"json"+r"\s+([\s\S]*?)"+re.escape(fence), response.text)
        if not match:
            return json.dumps({"reference":row,"text":response.text[:40000]},ensure_ascii=False)
        spec = json.loads(match[1])
        paths = spec.get("paths", {})
        needed = set()
        def scan(value):
            if isinstance(value,dict):
                if "$ref" in value and value["$ref"].startswith("#/components/schemas/"):
                    name=value["$ref"].split("/")[-1]
                    if name not in needed:
                        needed.add(name)
                        scan(spec.get("components",{}).get("schemas",{}).get(name,{}))
                for key,child in value.items():
                    if key not in ("example","examples"): scan(child)
            elif isinstance(value,list):
                for child in value: scan(child)
        scan(paths)
        result={"reference":row,"paths":paths,"schemas":{k:spec.get("components",{}).get("schemas",{}).get(k,{}) for k in needed}}
        serialized=json.dumps(result,ensure_ascii=False)
        if len(serialized)>180000:
            result["schemas"]={}
            result["note"]="Full schema is available at the reference URL. This response includes endpoint parameters and schema references."
            serialized=json.dumps(result,ensure_ascii=False)
        return serialized
    except httpx.HTTPError:
        raise ToolError("Connecteam's API reference could not be reached. Retry or consult the official reference URL.") from None

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", choices=("global","au"), default="global")
    options = parser.parse_args()
    os.environ["CONNECTEAM_API_REGION"] = options.region
    server.run()

