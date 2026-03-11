import sqlite3
import json
import uuid
from datetime import datetime
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "chats.db"


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT,
                created_at TEXT NOT NULL
            );
        """)
        # Migration: add tool_calls column to existing databases
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN tool_calls TEXT")
        except Exception:
            pass  # Column already exists


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# --- Chats ---

def create_chat(title: str = "New Chat") -> dict:
    chat_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (chat_id, title, now, now),
        )
    return {"id": chat_id, "title": title, "created_at": now, "updated_at": now}


def list_chats() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_chat(chat_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    return dict(row) if row else None


def update_chat_title(chat_id: str, title: str):
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, chat_id),
        )


def touch_chat(chat_id: str):
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id)
        )


def delete_chat(chat_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))


# --- Messages ---

def add_message(chat_id: str, role: str, content: str, tool_calls: list | None = None) -> dict:
    msg_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    tool_calls_json = json.dumps(tool_calls) if tool_calls else None
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, chat_id, role, content, tool_calls_json, now),
        )
    touch_chat(chat_id)
    return {"id": msg_id, "chat_id": chat_id, "role": role, "content": content, "tool_calls": tool_calls, "created_at": now}


def get_messages(chat_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC",
            (chat_id,),
        ).fetchall()
    result = []
    for r in rows:
        row = dict(r)
        row["tool_calls"] = json.loads(row["tool_calls"]) if row.get("tool_calls") else None
        result.append(row)
    return result
