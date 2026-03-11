const BASE = "http://localhost:8000";

export interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[] | null;
  created_at: string;
}

export interface ChatDetail extends Chat {
  messages: Message[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listChats: () => request<Chat[]>("/chats"),

  createChat: (title = "New Chat") =>
    request<Chat>("/chats", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getChat: (id: string) => request<ChatDetail>(`/chats/${id}`),

  updateTitle: (id: string, title: string) =>
    request<{ ok: boolean }>(`/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteChat: (id: string) =>
    request<{ ok: boolean }>(`/chats/${id}`, { method: "DELETE" }),

  sendMessage: (chatId: string, message: string) =>
    request<{ reply: string; tool_calls: ToolCall[] }>(`/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
};
