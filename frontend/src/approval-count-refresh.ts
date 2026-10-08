import type { ApprovalCountSummary } from './components/approval-count-badge';
import { approvalCountsFromSummary } from './approval-count-summary';

type SummaryResponse = { summary?: unknown } | null | undefined;

export function createApprovalCountRefresh(options: {
  read: () => Promise<SummaryResponse>;
  canRefresh: () => boolean;
  onUpdate: (summary: ApprovalCountSummary | null) => void;
}) {
  let active = true;
  let inFlight = false;
  let rerunRequested = false;
  let generation = 0;

  const refresh = () => {
    if (!active || !options.canRefresh()) return;
    if (inFlight) {
      rerunRequested = true;
      return;
    }
    inFlight = true;
    const requestGeneration = ++generation;
    void options.read().then((result) => {
      if (active && requestGeneration === generation && !rerunRequested) {
        options.onUpdate(approvalCountsFromSummary(result?.summary));
      }
    }).catch(() => {
      if (active && requestGeneration === generation && !rerunRequested) options.onUpdate(null);
    }).finally(() => {
      if (requestGeneration !== generation) return;
      inFlight = false;
      if (active && rerunRequested) {
        rerunRequested = false;
        refresh();
      }
    });
  };

  return {
    refresh,
    dispose() {
      active = false;
      generation += 1;
    }
  };
}
