import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from './SmsIcon';
import { TOAST_DURATION_MS, dismissToast, subscribeToasts, type ToastItem } from '../toast';

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismissToast(item.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current -= Date.now() - started; };
  }, [item.id, paused]);
  return <div className={`sms-toast sms-toast--${item.tone}`} role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <SmsIcon name={item.tone === 'success' ? 'check' : 'bell'} size={16} />
    <span>{item.message}</span>
    <button type="button" aria-label="ปิดการแจ้งเตือน" onClick={() => dismissToast(item.id)}><SmsIcon name="close" size={14} /></button>
  </div>;
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return createPortal(<div className="sms-toast-stack" aria-live="polite">{items.map((item) => <ToastCard key={item.id} item={item} />)}</div>, document.body);
}
