// Pure permission check used by the UI. The database enforces the real rules;
// this only decides what to show.

export type PermissionMap = Record<string, readonly string[]>;

/** True only for an active user whose role grants the permission. */
export function hasPermission(
  user: { role: string; active: boolean } | null | undefined,
  permissions: PermissionMap,
  permission: string,
): boolean {
  if (!user || !user.active) return false;
  return (permissions[user.role] ?? []).includes(permission);
}
