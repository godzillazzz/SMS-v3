// Owner decision 2026-10-27: success toasts auto-dismiss after 5 seconds. Errors stay inline where they happened.
export const TOAST_DURATION_MS = 5000;
export type ToastTone = 'success' | 'info' | 'warning';
export type ToastItem = { id: number; message: string; tone: ToastTone };

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(items));

export function showToast(message: string, tone: ToastTone = 'success') {
  const item = { id: nextId++, message, tone };
  items = [...items.slice(-3), item];
  emit();
  return item.id;
}

export function dismissToast(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  listener(items);
  return () => { listeners.delete(listener); };
}
