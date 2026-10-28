import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "./session";
import type { AgentUIMessage } from "./ui-message";

/**
 * Chats and each user's workspace (current chat, revealed contacts, saved
 * list, spend, cap) as JSON files under .data/, so a reload or a server
 * restart picks up where you left off. A local store for a demo: on a
 * serverless host, swap this for a database.
 */
const ROOT = path.join(process.cwd(), ".data");

const g = globalThis as typeof globalThis & {
  __psChatCache?: Map<string, AgentUIMessage[]>;
};
const chatCache = (g.__psChatCache ??= new Map());

/** One write at a time per file, so a read-modify-write never loses a field. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
  queues.set(key, next.catch(() => undefined));
  return next;
}

/** A stable, filename-safe key for the signed-in user. */
export async function ownerKey(session: Session) {
  const id = session.user.sub ?? session.user.email ?? session.refreshToken ?? session.accessToken;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ps:${id}`));
  return Buffer.from(digest).toString("hex").slice(0, 32);
}

const safeId = (id: string) => /^[\w-]{1,100}$/.test(id);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

const chatFile = (owner: string, id: string) => path.join(ROOT, "chats", owner, `${id}.json`);
const workspaceFile = (owner: string) => path.join(ROOT, "workspaces", `${owner}.json`);

export async function loadChat(owner: string, id: string): Promise<AgentUIMessage[]> {
  if (!safeId(id)) return [];
  const key = `${owner}/${id}`;
  const cached = chatCache.get(key);
  if (cached) return cached;
  const stored = (await readJson<{ messages: AgentUIMessage[] }>(chatFile(owner, id)))?.messages ?? [];
  chatCache.set(key, stored);
  return stored;
}

export async function saveChat(owner: string, id: string, messages: AgentUIMessage[]) {
  if (!safeId(id)) return;
  chatCache.set(`${owner}/${id}`, messages);
  await serial(chatFile(owner, id), () => writeJson(chatFile(owner, id), { messages, updatedAt: Date.now() }));
}

/** Whatever the browser sends; the client owns its shape (see PersistedUI in chat-state). */
export type StoredWorkspace = Record<string, unknown> & { chatId?: string };

export async function loadWorkspace(owner: string): Promise<StoredWorkspace | null> {
  return readJson<StoredWorkspace>(workspaceFile(owner));
}

export function saveWorkspace(owner: string, patch: StoredWorkspace) {
  const file = workspaceFile(owner);
  return serial(file, async () => {
    const current = (await loadWorkspace(owner)) ?? {};
    await writeJson(file, { ...current, ...patch, updatedAt: Date.now() });
  });
}
