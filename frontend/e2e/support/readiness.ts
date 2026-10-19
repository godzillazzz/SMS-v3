const DEFAULT_READINESS_TIMEOUT_MS = 60_000;

export function readinessTimeout(): number {
  const configured = Number.parseInt(process.env.PW_READY_TIMEOUT_MS ?? String(DEFAULT_READINESS_TIMEOUT_MS), 10);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : DEFAULT_READINESS_TIMEOUT_MS;
}