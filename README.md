# AI Assistant POC

A local AI assistant using **Google Gemini**, **FastMCP tools**, **SQLite chat history**, and a **React** frontend.

## Architecture

```
frontend/   React + Vite UI           → http://localhost:5173
api.py      FastAPI backend           → http://localhost:8000
mcp/server  FastMCP tool server       → http://localhost:8001
database.py SQLite chat persistence   → chats.db
```

## Setup

1. Create a `.env` file:
   ```
   GOOGLE_API_KEY=your_key_here
   ```

2. Install Python deps (requires uv):
   ```bash
   uv sync
   ```

3. Install frontend deps:
   ```bash
   cd frontend && npm install
   ```

## Running (3 terminals)

**Terminal 1 — MCP server:**
```bash
uv run python mcp/server.py
```

**Terminal 2 — FastAPI backend:**
```bash
uv run uvicorn api:app --reload --port 8000
```

**Terminal 3 — React frontend:**
```bash
cd frontend && npm run dev
```

Open **http://localhost:5173**

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_current_time` | Returns the current date/time (optional timezone) |
| `calculate` | Evaluates a math expression safely |

Add more tools in `mcp/server.py` — the backend auto-discovers them on startup.

## Adding Tools

In `mcp/server.py`:
```python
@mcp.tool()
def my_tool(arg: str) -> str:
    """Description shown to the model."""
    return "result"
```

Restart the MCP server; the backend picks up new tools automatically.
