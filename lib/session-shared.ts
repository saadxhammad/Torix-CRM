export type SessionUser = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
  /** Company RBAC role: Owner | HR | Staff | … */
  role: string;
};

export const SESSION_COOKIE = "torix_session";

export function isEmployeePortalRole(role: string | undefined | null) {
  return role === "Staff";
}

export function homePathForRole(role: string | undefined | null) {
  return isEmployeePortalRole(role) ? "/portal" : "/";
}

export function parseSessionPayload(raw: unknown): SessionUser | null {
  if (!raw || typeof raw !== "object") return null;
  const user = raw as Record<string, unknown>;
  if (!user.userId || !user.email) return null;
  // Do NOT default missing role to Staff — that wrongly sent Owners with old cookies to /portal.
  // Empty role forces re-login via middleware.
  return {
    userId: String(user.userId),
    email: String(user.email).toLowerCase(),
    displayName: String(user.displayName || user.email),
    fullName: user.fullName ? String(user.fullName) : null,
    role: user.role != null && user.role !== "" ? String(user.role) : "",
  };
}
