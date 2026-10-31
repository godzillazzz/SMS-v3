import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_UI_PALETTE, PALETTE_FIELDS, PALETTE_LABELS, isHexColour, paletteContrastChecks, type UiPalette } from '../ui-palette';
import { applyThemePreference, persistThemePreference, readThemePreference, type ThemePreference } from '../theme';
import '../styles/display-settings.css';

type Props = {
  canEdit: boolean;
  palette: UiPalette;
  onSave(palette: UiPalette): Promise<void> | void;
};

const MODES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
  { value: 'system', label: 'ตามระบบ' }
];

const upper = (palette: UiPalette) => Object.fromEntries(PALETTE_FIELDS.map((field) => [field, palette[field].toUpperCase()])) as UiPalette;

export function DisplaySettingsPanel({ canEdit, palette, onSave }: Props) {
  const [draft, setDraft] = useState<UiPalette>(() => upper(palette));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [mode, setMode] = useState<ThemePreference>(() => typeof window === 'undefined' ? 'system' : readThemePreference(window.localStorage));
  useEffect(() => { setDraft(upper(palette)); }, [palette]);

  const checks = useMemo(() => paletteContrastChecks(draft), [draft]);
  const invalid = checks.some((check) => !check.valid);
  const failing = checks.filter((check) => check.valid && !check.pass);
  const status = `${invalid ? 'รหัส HEX ไม่ถูกต้อง · ' : ''}${failing.length
    ? `ความต่างสีน้อยกว่า 4.5:1: ${failing.map((check) => `${check.label} ${check.ratio.toFixed(2)}:1`).join(', ')}`
    : invalid ? '' : 'ผ่านเกณฑ์ contrast 4.5:1 สำหรับทุกสี'}`;
  const safe = (field: keyof UiPalette, fallback: string) => isHexColour(draft[field]) ? draft[field] : fallback;

  const update = (field: keyof UiPalette, value: string) => { setNotice(undefined); setDraft((current) => ({ ...current, [field]: value.toUpperCase() })); };
  const reset = () => { setNotice(undefined); setDraft(upper(DEFAULT_UI_PALETTE)); };
  const save = async () => {
    if (invalid || failing.length) return;
    setSaving(true); setNotice(undefined);
    try {
      await onSave(Object.fromEntries(PALETTE_FIELDS.map((field) => [field, draft[field].toLowerCase()])) as UiPalette);
      setNotice({ tone: 'success', text: 'บันทึกสีของระบบแล้ว ผู้ใช้ทุกคนจะเห็นสีใหม่เมื่อโหลดหน้าใหม่' });
    } catch {
      setNotice({ tone: 'error', text: 'บันทึกสีไม่สำเร็จ กรุณาลองอีกครั้ง' });
    } finally { setSaving(false); }
  };
  const changeMode = (value: ThemePreference) => {
    setMode(value);
    persistThemePreference(value, window.localStorage);
    applyThemePreference(value, document.documentElement, window.matchMedia?.('(prefers-color-scheme: dark)'));
  };

  return <div className="display-settings">
    <div className="display-settings__heading">
      <p>ตั้งค่าสีระบบและเลือกโหมดการแสดงผล</p>
      {canEdit && <button type="button" className="btn-neutral small-action" data-display-reset onClick={reset}>คืนค่าเริ่มต้น</button>}
    </div>
    <div className="display-settings__grid">
      <section className="display-card" aria-labelledby="display-colors-title">
        <header className="display-card__head"><div><h3 id="display-colors-title">สีของระบบ</h3><p>เลือกสีหรือระบุรหัส HEX 6 หลัก</p></div><span className="display-badge">ADMIN</span></header>
        {!canEdit && <p className="display-readonly" role="note">แก้ไขได้เฉพาะผู้ดูแลระบบ (ADMIN) · แสดงสีที่ใช้อยู่ปัจจุบัน</p>}
        <div className="display-colors">
          {PALETTE_FIELDS.map((field) => <div className="display-color-row" key={field}>
            <label htmlFor={`display-color-${field}`}>{PALETTE_LABELS[field]}</label>
            <input type="color" aria-label={`เลือกสี ${PALETTE_LABELS[field]}`} value={safe(field, DEFAULT_UI_PALETTE[field]).toLowerCase()} disabled={!canEdit} onChange={(event) => update(field, event.target.value)} />
            <input id={`display-color-${field}`} type="text" className="display-hex" maxLength={7} value={draft[field]} readOnly={!canEdit} aria-invalid={!isHexColour(draft[field])} aria-describedby="display-contrast-status" onChange={(event) => update(field, event.target.value)} />
          </div>)}
        </div>
        <div id="display-contrast-status" className={`display-notice ${invalid || failing.length ? 'is-warning' : 'is-ok'}`} role="status">{status}</div>
        {canEdit && <button type="button" className="btn-primary compact" data-display-save disabled={saving || invalid || failing.length > 0} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึกสีของระบบ'}</button>}
        {notice && <p className={`display-save-note is-${notice.tone}`} role="status">{notice.text}</p>}
        <div className="display-mode">
          <h3>โหมดการแสดงผล</h3>
          <p>การเลือกโหมดเป็นค่าของผู้ใช้แต่ละคน · สีของระบบใช้กับโหมดสว่าง</p>
          <div className="display-mode__options" role="radiogroup" aria-label="โหมดการแสดงผล">
            {MODES.map((item) => <label key={item.value}><input type="radio" name="display-mode" value={item.value} checked={mode === item.value} onChange={() => changeMode(item.value)} /> {item.label}</label>)}
          </div>
        </div>
      </section>
      <section className="display-card" aria-labelledby="display-preview-title">
        <header className="display-card__head"><div><h3 id="display-preview-title">ตัวอย่างสด</h3><p>การเปลี่ยนสีแสดงที่นี่ทันที</p></div><span className="display-badge">ตัวอย่าง</span></header>
        <div className="display-preview">
          <div className="display-preview__card">
            <span className="display-muted">เข้างานแล้ววันนี้</span>
            <strong>42 <small>/ 48 คน</small></strong>
            <div className="display-preview__badges">
              <span style={{ color: safe('success', DEFAULT_UI_PALETTE.success), borderColor: safe('success', DEFAULT_UI_PALETTE.success) }}>ปกติ</span>
              <span style={{ color: safe('warning', DEFAULT_UI_PALETTE.warning), borderColor: safe('warning', DEFAULT_UI_PALETTE.warning) }}>เฝ้าระวัง</span>
              <span style={{ color: safe('danger', DEFAULT_UI_PALETTE.danger), borderColor: safe('danger', DEFAULT_UI_PALETTE.danger) }}>เร่งด่วน</span>
            </div>
          </div>
          <div className="display-preview__buttons">
            <span className="display-preview__btn is-primary" style={{ background: safe('buttonPrimary', DEFAULT_UI_PALETTE.buttonPrimary), borderColor: safe('buttonPrimary', DEFAULT_UI_PALETTE.buttonPrimary) }}>ปุ่มหลัก</span>
            <span className="display-preview__btn" style={{ color: safe('buttonSecondary', DEFAULT_UI_PALETTE.buttonSecondary), borderColor: safe('buttonSecondary', DEFAULT_UI_PALETTE.buttonSecondary) }}>ปุ่มรอง</span>
          </div>
          <p className="display-preview__text" style={{ color: safe('secondary', DEFAULT_UI_PALETTE.secondary) }}><strong style={{ color: safe('primary', DEFAULT_UI_PALETTE.primary) }}>สีหลัก</strong> · ข้อความสีรอง</p>
        </div>
        <ul className="display-contrast-list" aria-label="ผลตรวจ contrast">
          {checks.map((check) => <li key={check.field} className={check.pass ? 'is-ok' : 'is-warning'}><span>{check.label}</span><b>{check.valid ? `${check.ratio.toFixed(2)}:1` : '—'}</b></li>)}
        </ul>
        <p className="display-footnote">ตรวจ contrast สีตัวอักษรเทียบพื้นหลังโหมดสว่าง เกณฑ์ขั้นต่ำ 4.5:1 · ระบบไม่ยอมบันทึกสีที่ต่ำกว่าเกณฑ์</p>
      </section>
    </div>
  </div>;
}
