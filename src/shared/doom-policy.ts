// Closed rollout. The server checks the verified owner identity independently.
export function isDoomAdminOnly(): boolean {
  return true;
}
export function canAccessDoom(isAdmin: boolean): boolean {
  return !isDoomAdminOnly() || isAdmin;
}
export const DOOM_PRIVATE_MESSAGE = 'Freedoom пока доступен только владельцу.';
