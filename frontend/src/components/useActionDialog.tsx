import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from './SmsIcon';
import { useAccessibleOverlay } from './useAccessibleOverlay';
import '../styles/action-dialog.css';

export type ActionDialogTone = 'default' | 'primary' | 'warning' | 'danger';

type BaseOptions = {
  title: string;
  message: string;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ActionDialogTone;
  context?: string;
};

export type ConfirmDialogOptions = BaseOptions;

export type PromptDialogOptions = BaseOptions & {
  fieldLabel: string;
  initialValue?: string;
  placeholder?: string;
  helperText?: string;
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;
};

type ConfirmState = { kind: 'confirm'; options: ConfirmDialogOptions };
type PromptState = { kind: 'prompt'; options: PromptDialogOptions; value: string; validationError?: string };
type DialogState = ConfirmState | PromptState;
type DialogResolution = boolean | string | null;

function ActionDialogPortal({
  state,
  onCancel,
  onConfirm,
  onValueChange
}: {
  state: DialogState;
  onCancel(): void;
  onConfirm(): void;
  onValueChange(value: string): void;
}) {
  const titleId = 'sms-action-dialog-title';
  const descriptionId = 'sms-action-dialog-description';
  const isPrompt = state.kind === 'prompt';
  const options = state.options;
  const modalRef = useAccessibleOverlay<HTMLElement>(true, onCancel, {
    initialFocusSelector: isPrompt ? '[data-action-dialog-field]' : '[data-action-dialog-confirm]'
  });
  const tone = options.tone || 'default';
  const confirmClass = tone === 'danger' ? 'btn-danger' : tone === 'warning' ? 'btn-warning' : 'btn-primary';

  const content = <div className="sms-action-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <section
      ref={modalRef}
      className={`sms-action-dialog sms-action-dialog--${tone}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <header className="sms-action-dialog__header">
        <div>
          <p>{options.eyebrow || (isPrompt ? 'ระบุข้อมูลเพื่อดำเนินการ' : 'ยืนยันการดำเนินการ')}</p>
          <h2 id={titleId}>{options.title}</h2>
        </div>
        <button type="button" className="drawer-close overlay-close" onClick={onCancel} aria-label="ปิดหน้าต่าง">
          <SmsIcon name="close" size={20} />
        </button>
      </header>
      <div className="sms-action-dialog__body">
        <p id={descriptionId} className="sms-action-dialog__message">{options.message}</p>
        {options.context && <div className="sms-action-dialog__context">{options.context}</div>}
        {isPrompt && <label className="sms-action-dialog__field">
          <span>{state.options.fieldLabel}</span>
          {state.options.multiline
            ? <textarea
                data-action-dialog-field
                rows={4}
                value={state.value}
                maxLength={state.options.maxLength}
                placeholder={state.options.placeholder}
                onChange={(event) => onValueChange(event.target.value)}
              />
            : <input
                data-action-dialog-field
                value={state.value}
                maxLength={state.options.maxLength}
                placeholder={state.options.placeholder}
                onChange={(event) => onValueChange(event.target.value)}
              />}
          {state.options.helperText && <small>{state.options.helperText}</small>}
          {state.validationError && <small className="sms-action-dialog__validation" role="alert">{state.validationError}</small>}
        </label>}
      </div>
      <footer className="sms-action-dialog__actions">
        <button type="button" className="btn-neutral" onClick={onCancel}>{options.cancelLabel || 'ยกเลิก'}</button>
        <button type="button" className={confirmClass} data-action-dialog-confirm onClick={onConfirm}>{options.confirmLabel || 'ยืนยัน'}</button>
      </footer>
    </section>
  </div>;

  return createPortal(content, document.body);
}

export function useActionDialog() {
  const [state, setState] = useState<DialogState>();
  const resolverRef = useRef<((value: DialogResolution) => void)>();
  const kindRef = useRef<DialogState['kind']>();

  const settle = (value: DialogResolution) => {
    const resolver = resolverRef.current;
    resolverRef.current = undefined;
    kindRef.current = undefined;
    setState(undefined);
    resolver?.(value);
  };

  const cancelOutstanding = () => {
    if (!resolverRef.current) return;
    settle(kindRef.current === 'prompt' ? null : false);
  };

  useEffect(() => () => {
    const resolver = resolverRef.current;
    if (!resolver) return;
    resolverRef.current = undefined;
    resolver(kindRef.current === 'prompt' ? null : false);
  }, []);

  const confirm = (options: ConfirmDialogOptions) => {
    cancelOutstanding();
    kindRef.current = 'confirm';
    setState({ kind: 'confirm', options });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (value) => resolve(value === true);
    });
  };

  const prompt = (options: PromptDialogOptions) => {
    cancelOutstanding();
    kindRef.current = 'prompt';
    setState({ kind: 'prompt', options, value: options.initialValue || '' });
    return new Promise<string | null>((resolve) => {
      resolverRef.current = (value) => resolve(typeof value === 'string' ? value : null);
    });
  };

  const onConfirm = () => {
    if (!state) return;
    if (state.kind === 'confirm') {
      settle(true);
      return;
    }
    const trimmed = state.value.trim();
    const minLength = Math.max(0, state.options.minLength || 0);
    if (trimmed.length < minLength) {
      setState({ ...state, validationError: `กรุณาระบุอย่างน้อย ${minLength} ตัวอักษร` });
      return;
    }
    settle(state.value);
  };

  const onValueChange = (value: string) => {
    setState((current) => current?.kind === 'prompt' ? { ...current, value, validationError: undefined } : current);
  };

  return {
    confirm,
    prompt,
    dialog: state ? <ActionDialogPortal state={state} onCancel={cancelOutstanding} onConfirm={onConfirm} onValueChange={onValueChange} /> : null
  };
}
