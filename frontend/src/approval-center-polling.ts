export function shouldPollApprovalCenter(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState === 'visible';
}
