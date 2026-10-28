import type { ButtonHTMLAttributes } from 'react';
import { SmsIcon } from './SmsIcon';

// Owner request 2026-10-28: every row "edit" action is the same square-pen icon button.
// `label` names the target for assistive technology, e.g. "แก้ไข ทัศยุ สุริโย".
export function EditIconButton({ label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { label: string }) {
  return <button type="button" {...props} className={`sms-edit-button ${className}`.trim()} aria-label={label} title="แก้ไข">
    <SmsIcon name="edit" size={18} />
  </button>;
}
