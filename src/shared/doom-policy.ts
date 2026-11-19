// Public release. Player APIs still require verified Telegram identity and run ownership.
export function isDoomAdminOnly(): boolean {
  return false;
}
export function canAccessDoom(isAdmin: boolean): boolean {
  return !isDoomAdminOnly() || isAdmin;
}
export const DOOM_PRIVATE_MESSAGE = 'Freedoom пока доступен только владельцу.';
