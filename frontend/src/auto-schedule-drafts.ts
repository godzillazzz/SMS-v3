export type AutoSchedulePreviewRow = {
  employeeId?: unknown;
  date?: unknown;
  locked?: unknown;
  preserved?: unknown;
  existingShiftId?: unknown;
};

function previewDraftKey(row: AutoSchedulePreviewRow): string | undefined {
  const employeeId = String(row.employeeId ?? '').trim();
  const workDate = String(row.date ?? '').slice(0, 10);
  return employeeId && workDate ? `${employeeId}_${workDate}` : undefined;
}

function alreadyScheduled(row: AutoSchedulePreviewRow, key: string, drafts: Record<string, unknown>): boolean {
  return Boolean(row.locked || row.preserved || row.existingShiftId)
    || Object.prototype.hasOwnProperty.call(drafts, key);
}

export function summarizeAutoSchedulePreview(rows: AutoSchedulePreviewRow[], drafts: Record<string, unknown>) {
  return rows.reduce((summary, row) => {
    const key = previewDraftKey(row);
    if (!key) return summary;
    if (alreadyScheduled(row, key, drafts)) summary.preservedExisting += 1;
    else summary.generated += 1;
    return summary;
  }, { generated: 0, preservedExisting: 0 });
}

export function addAutoSchedulePreviewDrafts<TDraft>(
  drafts: Record<string, TDraft>,
  rows: AutoSchedulePreviewRow[],
  createDraft: (row: AutoSchedulePreviewRow) => TDraft | undefined
): Record<string, TDraft> {
  const nextDrafts = { ...drafts };
  for (const row of rows) {
    const key = previewDraftKey(row);
    if (!key || alreadyScheduled(row, key, drafts)) continue;
    const draft = createDraft(row);
    if (draft !== undefined) nextDrafts[key] = draft;
  }
  return nextDrafts;
}
