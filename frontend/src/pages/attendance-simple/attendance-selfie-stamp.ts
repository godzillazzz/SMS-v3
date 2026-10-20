export type AttendanceSelfieStampContext = {
  employeeName: string;
  employeeCode: string;
  action: string;
  capturedAt: Date;
  siteName: string;
  supportSite: boolean;
  accuracyMeters: number;
  reference: string;
};

export function formatBangkokStampTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(value);
}

export function attendanceStampLines(context: AttendanceSelfieStampContext): string[] {
  return [
    `${context.employeeName} · ${context.employeeCode || '—'}`,
    `${context.action} · ${formatBangkokStampTime(context.capturedAt)} Asia/Bangkok`,
    `Site: ${context.siteName || 'นอก Active Site'}${context.supportSite ? ' · Support Site' : ''}`,
    `GPS accuracy: ${Math.round(context.accuracyMeters)} m · Ref: ${context.reference}`
  ];
}

/** Informational pixels only: this never changes selfie verification or nonce data. */
export function paintAttendanceSelfieStamp(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  stamp: AttendanceSelfieStampContext
): void {
  const lines = attendanceStampLines(stamp);
  const stampHeight = Math.max(72, Math.round(height * 0.16));
  context.fillStyle = 'rgba(0, 0, 0, 0.72)';
  context.fillRect(0, height - stampHeight, width, stampHeight);
  context.fillStyle = '#fff';
  context.font = `${Math.max(12, Math.round(width / 42))}px sans-serif`;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 12, height - stampHeight + 8 + index * Math.max(16, Math.round(width / 38))));
}
