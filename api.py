import hashlib
import json
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import Client as MCPClient
from google import genai
from google.genai import types
from pydantic import BaseModel

import database as db

load_dotenv()

# ---------------------------------------------------------------------------
# Caching (simple in-memory LRU-style dict keyed by request hash)
# ---------------------------------------------------------------------------
_cache: dict[str, str] = {}
_CACHE_MAX = 256


def _cache_key(model: str, messages: list) -> str:
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _cache_get(key: str) -> str | None:
    return _cache.get(key)


def _cache_set(key: str, value: str):
    if len(_cache) >= _CACHE_MAX:
        oldest = next(iter(_cache))
        del _cache[oldest]
    _cache[key] = value


# ---------------------------------------------------------------------------
# MCP client helpers  (uses FastMCP's own Python client over its protocol)
# ---------------------------------------------------------------------------
MCP_URL = os.environ.get("MCP_URL", "http://127.0.0.1:8001/mcp")

_mcp_tools_cache: list[types.Tool] | None = None


def _map_type(mcp_type: str) -> str:
    return {
        "string": "STRING",
        "number": "NUMBER",
        "integer": "INTEGER",
        "boolean": "BOOLEAN",
        "array": "ARRAY",
        "object": "OBJECT",
    }.get(mcp_type, "STRING")


async def fetch_mcp_tools() -> list[types.Tool]:
    """Fetch tool schemas from the MCP server via FastMCP client and cache them."""
    global _mcp_tools_cache
    if _mcp_tools_cache is not None:
        return _mcp_tools_cache

    async with MCPClient(MCP_URL) as mcp:
        tools_raw = await mcp.list_tools()

    gemini_tools: list[types.Tool] = []
    for t in tools_raw:
        schema = t.inputSchema or {}
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        params: dict = {
            "type": "object",
            "properties": {
                name: {
                    "type": _map_type(prop.get("type", "string")),
                    "description": prop.get("description", ""),
                }
                for name, prop in properties.items()
            },
        }
        if required:
            params["required"] = required

        gemini_tools.append(
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name=t.name,
                        description=t.description or "",
                        parameters=params,
                    )
                ]
            )
        )

    _mcp_tools_cache = gemini_tools
    return gemini_tools


async def call_mcp_tool(name: str, args: dict) -> str:
    """Call a tool on the MCP server via FastMCP client and return its text result."""
    async with MCPClient(MCP_URL) as mcp:
        result = await mcp.call_tool(name, args)

    # result is a CallToolResult with a .content list of ContentBlock objects
    texts = [c.text for c in result.content if hasattr(c, "text")]
    return "\n".join(texts) if texts else str(result.data)


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------
_gemini_client = genai.Client()
MODEL = "gemini-2.5-flash"


async def chat_with_gemini(
    history: list[dict], user_message: str
) -> tuple[str, list[dict]]:
    """
    Send the full conversation history + new user message to Gemini,
    handle tool calls via MCP, and return (reply_text, tool_calls).
    tool_calls is a list of {"name", "args", "result"} dicts.
    """
    tools = await fetch_mcp_tools()

    # Build Gemini contents from history
    contents: list[types.Content] = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))

    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))

    cache_key = _cache_key(MODEL, [{"role": c.role, "text": c.parts[0].text} for c in contents])
    cached = _cache_get(cache_key)
    if cached:
        return cached, []

    # Agentic loop: keep calling until no more tool calls
    loop_contents = list(contents)
    collected_tool_calls: list[dict] = []
    max_iters = 5

    for _ in range(max_iters):
        response = _gemini_client.models.generate_content(
            model=MODEL,
            contents=loop_contents,
            config=types.GenerateContentConfig(tools=tools) if tools else None,
        )

        candidate = response.candidates[0]
        response_parts = candidate.content.parts

        fn_calls = [p for p in response_parts if p.function_call]
        if not fn_calls:
            text = "".join(p.text for p in response_parts if p.text)
            _cache_set(cache_key, text)
            return text, collected_tool_calls

        loop_contents.append(types.Content(role="model", parts=response_parts))

        tool_result_parts = []
        for part in fn_calls:
            fn = part.function_call
            args = dict(fn.args)
            result_text = await call_mcp_tool(fn.name, args)

            collected_tool_calls.append({"name": fn.name, "args": args, "result": result_text})

            tool_result_parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=fn.name,
                        response={"result": result_text},
                    )
                )
            )

        loop_contents.append(types.Content(role="user", parts=tool_result_parts))

    return "I reached the maximum number of tool-call iterations.", collected_tool_calls


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    # Pre-warm MCP tool list (best effort)
    try:
        await fetch_mcp_tools()
    except Exception:
        pass
    yield


app = FastAPI(title="AI Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request / Response models ---

class SendMessageRequest(BaseModel):
    message: str


class CreateChatRequest(BaseModel):
    title: str = "New Chat"


class UpdateChatTitleRequest(BaseModel):
    title: str


# --- Chat routes ---

@app.get("/chats")
def list_chats():
    return db.list_chats()


@app.post("/chats")
def create_chat(req: CreateChatRequest):
    return db.create_chat(req.title)


@app.get("/chats/{chat_id}")
def get_chat(chat_id: str):
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404, "Chat not found")
    messages = db.get_messages(chat_id)
    return {**chat, "messages": messages}


@app.patch("/chats/{chat_id}")
def update_chat_title(chat_id: str, req: UpdateChatTitleRequest):
    db.update_chat_title(chat_id, req.title)
    return {"ok": True}


@app.delete("/chats/{chat_id}")
def delete_chat(chat_id: str):
    db.delete_chat(chat_id)
    return {"ok": True}


@app.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, req: SendMessageRequest):
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Persist user message
    db.add_message(chat_id, "user", req.message)

    # Retrieve full history (excluding the message we just added for context building)
    history = db.get_messages(chat_id)[:-1]  # everything before the new message

    try:
        reply, tool_calls = await chat_with_gemini(history, req.message)
    except Exception as e:
        raise HTTPException(500, f"Model error: {e}") from e

    # Auto-title the chat after first exchange
    if chat["title"] == "New Chat" and len(history) == 0:
        title = req.message[:50] + ("…" if len(req.message) > 50 else "")
        db.update_chat_title(chat_id, title)

    # Persist assistant reply with any tool calls
    db.add_message(chat_id, "assistant", reply, tool_calls or None)

    return {"reply": reply, "tool_calls": tool_calls}


@app.get("/health")
def health():
    return {"status": "ok", "cache_size": len(_cache)}
