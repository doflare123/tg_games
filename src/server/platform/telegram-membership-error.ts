// Classify only explicit user lookup failures. Other 400s, 403s, 429s and
// transport failures must retain their retry/error behavior.
export function isUnavailableMembership(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = error as Record<string, unknown>;
  if (data.code !== 400 && data.error_code !== 400) return false;
  const description = typeof data.description === 'string' ? data.description : data.message;
  return (
    typeof description === 'string' &&
    /(?:^|:\s*)(?:PARTICIPANT_ID_INVALID|USER_ID_INVALID|user not found)$/i.test(description)
  );
}
