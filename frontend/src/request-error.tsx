import type { MouseEvent } from 'react';
import { ApiRequestError, normalizeRequestId } from './api';

export type RequestErrorState = {
  message: string;
  requestId?: string;
};

export type RequestErrorInput = RequestErrorState | string | undefined | null;

const defaultMessage = 'ระบบไม่สามารถดำเนินการได้ชั่วคราว กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาให้ติดต่อผู้ดูแลระบบ';
const unsafeTechnicalMessage = /(?:internal server error|unexpected error|database unavailable|database[_ ]?url|postgres(?:ql)?|prisma|\bsql\b|stack trace|storageobjectkey|storage object key|signed.?url|authorization|bearer\s+|access[_ -]?token|refresh[_ -]?token|cookie|credential|environment variable|internal file path)/i;

export function safeUserErrorMessage(value: unknown, fallback = defaultMessage) {
  const text = typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : '';
  if (!text || unsafeTechnicalMessage.test(text)) return fallback;
  return text.slice(0, 300);
}

export function toRequestErrorState(reason: unknown, fallback = defaultMessage): RequestErrorState {
  if (typeof reason === 'string') return { message: safeUserErrorMessage(reason, fallback) };
  if (reason && typeof reason === 'object' && !(reason instanceof Error) && 'message' in reason) {
    const message = safeUserErrorMessage((reason as { message?: unknown }).message, fallback);
    const requestId = normalizeRequestId((reason as { requestId?: unknown }).requestId);
    return requestId ? { message, requestId } : { message };
  }
  if (reason instanceof Error) {
    const message = safeUserErrorMessage(reason.message, fallback);
    const requestId = reason instanceof ApiRequestError ? normalizeRequestId(reason.requestId) : undefined;
    return requestId ? { message, requestId } : { message };
  }
  return { message: fallback };
}

export function normalizeRequestErrorInput(error: RequestErrorInput, fallback = defaultMessage): RequestErrorState | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return toRequestErrorState(error, fallback);
  const message = safeUserErrorMessage(error.message, fallback);
  const requestId = normalizeRequestId(error.requestId);
  return requestId ? { message, requestId } : { message };
}

export async function copyRequestId(requestId: unknown, button?: HTMLButtonElement | null) {
  const safeRequestId = normalizeRequestId(requestId);
  if (!safeRequestId || !globalThis.navigator?.clipboard?.writeText) return false;
  try {
    await globalThis.navigator.clipboard.writeText(safeRequestId);
    if (button) button.textContent = 'คัดลอกแล้ว';
    return true;
  } catch {
    return false;
  }
}

export function RequestErrorReference({ requestId }: { requestId?: unknown }) {
  const safeRequestId = normalizeRequestId(requestId);
  if (!safeRequestId) return null;
  return <span className="request-error-reference">
    <span className="request-error-reference-label">รหัสอ้างอิง</span>
    <code className="request-error-reference-id">{safeRequestId}</code>
    <button
      type="button"
      className="request-error-copy"
      onClick={async (event: MouseEvent<HTMLButtonElement>) => { await copyRequestId(safeRequestId, event.currentTarget); }}
    >คัดลอกรหัส</button>
  </span>;
}

export function RequestErrorContent({ error, fallback }: { error: RequestErrorInput; fallback?: string }) {
  const state = normalizeRequestErrorInput(error, fallback);
  if (!state) return null;
  return <>
    <span>{state.message}</span>
    <RequestErrorReference requestId={state.requestId} />
  </>;
}
