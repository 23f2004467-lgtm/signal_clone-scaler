// One small fetch wrapper for every REST call (blueprint §7).
// The base URL is a NEXT_PUBLIC_ literal, so Next.js inlines it into the
// client bundle at build time; the fallback covers plain local dev.

import type {
  ConversationSummary,
  MemberInfo,
  Message,
  User,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_KEY = "token";
const USER_KEY = "user";

// --- session storage (localStorage; guarded so prerendering never touches it) ---

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function saveSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// --- the wrapper itself ---

export class ApiError extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // FastAPI errors look like {"detail": "..."}; fall back to the status text.
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

// --- typed helpers, one per REST endpoint (blueprint §7) ---

export const api = {
  // auth
  register: (phone: string, username: string, display_name: string) =>
    request<User>("POST", "/api/auth/register", {
      phone,
      username,
      display_name,
    }),

  // FastAPI's DetailOut shape ({"detail": "OTP sent"}) — not {message}.
  login: (phone_or_username: string) =>
    request<{ detail: string }>("POST", "/api/auth/login", {
      phone_or_username,
    }),

  verifyOtp: (phone_or_username: string, otp: string) =>
    request<{ token: string; user: User }>("POST", "/api/auth/verify-otp", {
      phone_or_username,
      otp,
    }),

  logout: () => request<{ detail: string }>("POST", "/api/auth/logout"),

  me: () => request<User>("GET", "/api/auth/me"),

  // users + contacts
  searchUsers: (q: string) =>
    request<User[]>("GET", `/api/users/search?q=${encodeURIComponent(q)}`),

  listContacts: () => request<User[]>("GET", "/api/contacts"),

  addContact: (user_id: number) =>
    request<User>("POST", "/api/contacts", { user_id }),

  // conversations
  listConversations: () =>
    request<ConversationSummary[]>("GET", "/api/conversations"),

  createDm: (peer_id: number) =>
    request<ConversationSummary>("POST", "/api/conversations", { peer_id }),

  createGroup: (name: string, member_ids: number[]) =>
    request<ConversationSummary>("POST", "/api/conversations", {
      name,
      member_ids,
    }),

  listMessages: (conversationId: number, beforeId?: number, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId !== undefined) params.set("before_id", String(beforeId));
    return request<Message[]>(
      "GET",
      `/api/conversations/${conversationId}/messages?${params}`
    );
  },

  // groups (M3) — the REST handlers also push member.added / member.removed
  // through the server's ConnectionManager
  addMember: (conversationId: number, user_id: number) =>
    request<MemberInfo>("POST", `/api/conversations/${conversationId}/members`, {
      user_id,
    }),

  removeMember: (conversationId: number, userId: number) =>
    request<{ detail: string }>(
      "DELETE",
      `/api/conversations/${conversationId}/members/${userId}`
    ),

  // The backend returns just {id, name} (schemas.RenameOut) — the rename is
  // the only field that changed, so that is all it sends.
  renameGroup: (conversationId: number, name: string) =>
    request<{ id: number; name: string }>(
      "PATCH",
      `/api/conversations/${conversationId}`,
      { name }
    ),
};
