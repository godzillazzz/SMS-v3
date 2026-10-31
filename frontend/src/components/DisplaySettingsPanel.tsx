import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_UI_PALETTE,
  DEFAULT_SIDEBAR_OPTIONS,
  PALETTE_FIELDS,
  PALETTE_LABELS,
  isHexColour,
  contrastRatio,
  paletteContrastChecks,
  type UiPaletteWithSidebar,
  type SidebarOption
} from '../ui-palette';
import { applyThemePreference, persistThemePreference, readThemePreference, type ThemePreference } from '../theme';
import '../styles/display-settings.css';

type Props = {
  canEdit: boolean;
  palette: UiPaletteWithSidebar;
  onSave(palette: UiPaletteWithSidebar): Promise<void> | void;
};

const MODES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
  { value: 'system', label: 'ตามระบบ' }
];

const upper = (palette: UiPaletteWithSidebar) => {
  const res = Object.fromEntries(PALETTE_FIELDS.map((field) => [field, palette[field].toUpperCase()])) as unknown as UiPaletteWithSidebar;
  if (palette.sidebarOptions) {
    res.sidebarOptions = palette.sidebarOptions.map((opt) => ({
      ...opt,
      color: opt.color.toUpperCase()
    }));
  }
  return res;
};

export function DisplaySettingsPanel({ canEdit, palette, onSave }: Props) {
  const [draft, setDraft] = useState<UiPaletteWithSidebar>(() => upper(palette));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [mode, setMode] = useState<ThemePreference>(() => typeof window === 'undefined' ? 'system' : readThemePreference(window.localStorage));
  const [newSidebarLabel, setNewSidebarLabel] = useState('');
  const [newSidebarColor, setNewSidebarColor] = useState('#1E3A5F');

  useEffect(() => { setDraft(upper(palette)); }, [palette]);

  const checks = useMemo(() => paletteContrastChecks(draft), [draft]);
  const invalid = checks.some((check) => !check.valid);
  const failing = checks.filter((check) => check.valid && !check.pass);

  const effectiveSidebarOptions = useMemo(() => {
    return draft.sidebarOptions !== undefined ? draft.sidebarOptions : DEFAULT_SIDEBAR_OPTIONS;
  }, [draft.sidebarOptions]);

  // Check contrast for sidebar options against white text (#ffffff)
  const sidebarFailing = useMemo(() => {
    return effectiveSidebarOptions.filter((opt) => {
      if (!isHexColour(opt.color)) return true;
      return contrastRatio(opt.color, '#ffffff') < 4.5;
    });
  }, [effectiveSidebarOptions]);

  const status = `${invalid ? 'รหัส HEX ไม่ถูกต้อง · ' : ''}${failing.length || sidebarFailing.length
    ? `ความต่างสีน้อยกว่า 4.5:1: ${[
        ...failing.map((check) => `${check.label} ${check.ratio.toFixed(2)}:1`),
        ...sidebarFailing.map((opt) => `Sidebar ${opt.label || opt.id} (${contrastRatio(opt.color, '#ffffff').toFixed(2)}:1)`)
      ].join(', ')}`
    : invalid ? '' : 'ผ่านเกณฑ์ contrast 4.5:1 สำหรับทุกสี'}`;
  const safe = (field: keyof UiPaletteWithSidebar, fallback: string) => isHexColour(draft[field] as string) ? (draft[field] as string) : fallback;

  const update = (field: keyof UiPaletteWithSidebar, value: string) => { setNotice(undefined); setDraft((current) => ({ ...current, [field]: value.toUpperCase() })); };
  const reset = () => { setNotice(undefined); setDraft(upper(DEFAULT_UI_PALETTE)); };

  const addSidebarColor = () => {
    if (!isHexColour(newSidebarColor)) return;
    const id = `sb-${Date.now()}`;
    const label = newSidebarLabel.trim() || newSidebarColor.toUpperCase();
    const newOpt: SidebarOption = { id, label, color: newSidebarColor.toUpperCase() };
    setDraft((cur) => {
      const base = cur.sidebarOptions !== undefined ? cur.sidebarOptions : DEFAULT_SIDEBAR_OPTIONS;
      return {
        ...cur,
        sidebarOptions: [...base, newOpt]
      };
    });
    setNewSidebarLabel('');
    setNewSidebarColor('#1E3A5F');
  };

  const removeSidebarColor = (id: string) => {
    setDraft((cur) => {
      const base = cur.sidebarOptions !== undefined ? cur.sidebarOptions : DEFAULT_SIDEBAR_OPTIONS;
      return {
        ...cur,
        sidebarOptions: base.filter((opt) => opt.id !== id)
      };
    });
  };

  const save = async () => {
    if (invalid || failing.length || sidebarFailing.length) return;
    setSaving(true); setNotice(undefined);
    try {
      const payload: UiPaletteWithSidebar = Object.fromEntries(
        PALETTE_FIELDS.map((field) => [field, (draft[field] as string).toLowerCase()])
      ) as unknown as UiPaletteWithSidebar;
      if (draft.sidebarOptions) {
        payload.sidebarOptions = draft.sidebarOptions.map((opt) => ({
          ...opt,
          color: opt.color.toLowerCase()
        }));
      }
      await onSave(payload);
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
        <div id="display-contrast-status" className={`display-notice ${invalid || failing.length || sidebarFailing.length ? 'is-warning' : 'is-ok'}`} role="status">{status}</div>

        <div className="display-sidebar-section">
          <h3>สีแถบข้าง (Sidebar)</h3>
          <p>Admin เพิ่มหรือลบตัวเลือกสีแถบข้างที่ให้ผู้ใช้เลือกได้ (สีต้องมี contrast กับตัวอักษรสีขาวอย่างน้อย 4.5:1)</p>
          <div className="display-sidebar-list">
            {effectiveSidebarOptions.length > 0 ? (
              effectiveSidebarOptions.map((opt) => (
                <div key={opt.id} className="display-sidebar-item">
                  <div className="display-sidebar-swatch">
                    <span style={{ backgroundColor: opt.color }} />
                    <b>{opt.label}</b>
                    <small>({opt.color})</small>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn-delete-color"
                      aria-label={`ลบสี ${opt.label}`}
                      onClick={() => removeSidebarColor(opt.id)}
                    >
                      ลบ
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="display-readonly">ยังไม่มีสีแถบข้าง (เลือกใช้ค่าสีระบบ)</p>
            )}
          </div>

          {canEdit && (
            <div className="display-sidebar-add">
              <input
                type="color"
                aria-label="เลือกสีแถบข้างใหม่"
                value={newSidebarColor}
                onChange={(e) => setNewSidebarColor(e.target.value.toUpperCase())}
              />
              <input
                type="text"
                className="display-hex-short"
                maxLength={7}
                placeholder="#1E3A5F"
                aria-label="รหัสสีแถบข้าง HEX"
                value={newSidebarColor}
                onChange={(e) => setNewSidebarColor(e.target.value.toUpperCase())}
              />
              <input
                type="text"
                placeholder="ชื่อเรียกสี (เช่น น้ำเงินเข้ม)"
                aria-label="ชื่อสีแถบข้าง"
                value={newSidebarLabel}
                onChange={(e) => setNewSidebarLabel(e.target.value)}
              />
              <button
                type="button"
                className="btn-neutral compact"
                onClick={addSidebarColor}
                disabled={!isHexColour(newSidebarColor)}
              >
                + เพิ่มสีแถบข้าง
              </button>
            </div>
          )}
        </div>

        {canEdit && <button type="button" className="btn-primary compact" data-display-save disabled={saving || invalid || failing.length > 0 || sidebarFailing.length > 0} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึกสีของระบบ'}</button>}
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
