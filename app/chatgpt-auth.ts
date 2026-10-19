import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/session";

/** Kept name for compatibility with existing imports. */
export type ChatGPTUser = SessionUser;

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return getSessionUser();
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  redirect(`/login?return_to=${encodeURIComponent(safe)}`);
}

export function chatGPTSignInPath(returnTo: string): string {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/login?return_to=${encodeURIComponent(safe)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/logout?return_to=${encodeURIComponent(safe)}`;
}
