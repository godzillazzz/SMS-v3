// Owner decision 2026-10-27: name avatars use 8 colours, fixed per person.
// Employees are keyed by employee code; user accounts by user id (the audit log only carries the actor id).
export const AVATAR_TONE_COUNT = 8;

export function avatarTone(key: unknown): number {
  const value = String(key ?? '').trim().toLowerCase();
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ (char.codePointAt(0) || 0), 16777619);
  return (hash >>> 0) % AVATAR_TONE_COUNT;
}
