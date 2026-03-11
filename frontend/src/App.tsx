import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Chat, Message, ToolCall, UploadedFile } from "./api";
import "./App.css";

// ── small helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso + "Z").getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Markdown-ish renderer (bold, code blocks, inline code) ─────────────────

function renderContent(text: string) {
  const lines = text.split("\n");
  const result: JSX.Element[] = [];
  let codeBlock: string[] = [];
  let inCode = false;
  let codeLang = "";
  let keyIdx = 0;

  const flush = () => {
    if (codeBlock.length) {
      result.push(
        <pre key={keyIdx++} className="code-block">
          {codeLang && <span className="code-lang">{codeLang}</span>}
          <code>{codeBlock.join("\n")}</code>
        </pre>
      );
      codeBlock = [];
      codeLang = "";
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) { flush(); inCode = false; }
      else { inCode = true; codeLang = line.slice(3).trim(); }
      continue;
    }
    if (inCode) { codeBlock.push(line); continue; }
    result.push(
      <p key={keyIdx++} className="msg-line">{parseInline(line)}</p>
    );
  }
  if (inCode) flush();
  return result;
}

function parseInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length) {
    const codeIdx = remaining.indexOf("`");
    const boldIdx = remaining.indexOf("**");

    if (codeIdx === -1 && boldIdx === -1) { parts.push(remaining); break; }

    if (codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx)) {
      parts.push(remaining.slice(0, codeIdx));
      const end = remaining.indexOf("`", codeIdx + 1);
      if (end === -1) { parts.push(remaining.slice(codeIdx)); break; }
      parts.push(<code key={key++} className="inline-code">{remaining.slice(codeIdx + 1, end)}</code>);
      remaining = remaining.slice(end + 1);
    } else {
      parts.push(remaining.slice(0, boldIdx));
      const end = remaining.indexOf("**", boldIdx + 2);
      if (end === -1) { parts.push(remaining.slice(boldIdx)); break; }
      parts.push(<strong key={key++}>{remaining.slice(boldIdx + 2, end)}</strong>);
      remaining = remaining.slice(end + 2);
    }
  }
  return parts;
}

// ── ToolCallBlock ──────────────────────────────────────────────────────────

function ToolCallBlock({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="tool-call">
      <button className="tool-call-header" onClick={() => setOpen((o) => !o)}>
        <span className="tool-call-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
        </span>
        <span className="tool-call-name">{call.name}</span>
        <span className="tool-call-chevron" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="tool-call-body">
          <div className="tool-call-section">
            <span className="tool-call-label">Arguments</span>
            <pre className="tool-call-pre">{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          <div className="tool-call-section">
            <span className="tool-call-label">Result</span>
            <pre className="tool-call-pre">{call.result}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  chats, activeChatId, onSelect, onNew, onDelete,
}: {
  chats: Chat[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Chats</span>
        <button className="btn-new" onClick={onNew} title="New chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <ul className="chat-list">
        {chats.length === 0 && <li className="chat-empty">No chats yet</li>}
        {chats.map((c) => (
          <li
            key={c.id}
            className={`chat-item ${c.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="chat-item-inner">
              <span className="chat-item-title">{c.title}</span>
              <span className="chat-item-time">{timeAgo(c.updated_at)}</span>
            </div>
            <button className="btn-delete" title="Delete chat"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────

function FileAttachment({ file }: { file: UploadedFile }) {
  const isImage = file.mime_type.startsWith("image/");
  const url = `http://localhost:8000/files/${file.id}`;
  return (
    <a className="file-attachment" href={url} target="_blank" rel="noreferrer">
      {isImage ? (
        <img src={url} alt={file.original_name} className="file-thumb" />
      ) : (
        <span className="file-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
      )}
      <span className="file-name">{file.original_name}</span>
    </a>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const hasTools = msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0;
  const hasFiles = msg.files && msg.files.length > 0;
  return (
    <div className={`bubble-wrap ${msg.role}`}>
      <div className={`bubble ${msg.role}`}>
        {hasTools && (
          <div className="tool-calls-list">
            {msg.tool_calls!.map((tc, i) => (
              <ToolCallBlock key={i} call={tc} />
            ))}
          </div>
        )}
        {hasFiles && (
          <div className="file-attachments">
            {msg.files!.map((f) => <FileAttachment key={f.id} file={f} />)}
          </div>
        )}
        <div className="bubble-content">{renderContent(msg.content)}</div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listChats().then(setChats).catch(console.error);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const loadChat = async (id: string) => {
    setError(null);
    try {
      const detail = await api.getChat(id);
      setActiveChatId(id);
      setMessages(detail.messages);
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const handleNew = async () => {
    try {
      const chat = await api.createChat();
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setMessages([]);
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeChatId === id) { setActiveChatId(null); setMessages([]); }
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const chat = await api.createChat();
        setChats((prev) => [chat, ...prev]);
        chatId = chat.id;
        setActiveChatId(chat.id);
      } catch (e: unknown) { setError((e as Error).message); return; }
    }

    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => api.uploadFile(chatId!, f)));
      setPendingFiles((prev) => [...prev, ...uploaded]);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending) return;
    setError(null);

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const chat = await api.createChat();
        setChats((prev) => [chat, ...prev]);
        chatId = chat.id;
        setActiveChatId(chat.id);
      } catch (e: unknown) { setError((e as Error).message); return; }
    }

    const fileIds = pendingFiles.map((f) => f.id);
    const filesToAttach = [...pendingFiles];
    const optimistic: Message = {
      id: "tmp-" + Date.now(), chat_id: chatId, role: "user",
      content: text || " ", files: filesToAttach, created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setPendingFiles([]);
    setSending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await api.sendMessage(chatId, text || " ", fileIds);
      const assistantMsg: Message = {
        id: "tmp-a-" + Date.now(), chat_id: chatId, role: "assistant",
        content: res.reply,
        tool_calls: res.tool_calls?.length ? res.tool_calls : null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      const updatedChats = await api.listChats();
      setChats(updatedChats);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  return (
    <div className="layout">
      <Sidebar chats={chats} activeChatId={activeChatId}
        onSelect={loadChat} onNew={handleNew} onDelete={handleDelete} />

      <main className="chat-area">
        <div className="messages">
          {messages.length === 0 && !activeChatId && (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <p>Start a new conversation</p>
              <button className="btn-start" onClick={handleNew}>New Chat</button>
            </div>
          )}
          {messages.length === 0 && activeChatId && (
            <div className="empty-state"><p>Send a message to begin</p></div>
          )}

          {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}

          {sending && (
            <div className="bubble-wrap assistant">
              <div className="bubble assistant typing">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>⚠ {error}</span>
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-bar">
          {pendingFiles.length > 0 && (
            <div className="pending-files">
              {pendingFiles.map((f) => (
                <span key={f.id} className="pending-chip">
                  <span className="pending-chip-name">{f.original_name}</span>
                  <button className="pending-chip-remove" onClick={() =>
                    setPendingFiles((prev) => prev.filter((x) => x.id !== f.id))
                  }>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="input-wrap">
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
              onChange={handleFileChange} />
            <button className="btn-attach" onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploading} title="Attach file">
              {uploading ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.5 }}>
                  <circle cx="12" cy="12" r="10" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
            <textarea ref={textareaRef} className="input-text" value={input}
              onChange={handleInputChange} onKeyDown={handleKey}
              placeholder="Message…" rows={1} disabled={sending} />
            <button className="btn-send" onClick={handleSend}
              disabled={(!input.trim() && pendingFiles.length === 0) || sending}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for newline</p>
        </div>
      </main>
    </div>
  );
}
