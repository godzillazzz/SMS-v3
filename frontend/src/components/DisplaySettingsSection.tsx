import { useEffect, useState } from 'react';
import { api } from '../api';
import { DisplaySettingsPanel } from './DisplaySettingsPanel';
import { DEFAULT_UI_PALETTE, UI_PALETTE_KEY, applyUiPalette, isValidPalette, type UiPalette } from '../ui-palette';

export function DisplaySettingsSection({ token, canEdit }: { token: string; canEdit: boolean }) {
  const [palette, setPalette] = useState<UiPalette>(DEFAULT_UI_PALETTE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    api.uiTheme(token)
      .then((response: any) => { if (active && isValidPalette(response?.data?.palette)) setPalette(response.data.palette); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  if (loading) return <div className="loading-row" role="status">กำลังอ่านสีของระบบ…</div>;
  return <>
    {loadError && <div className="alert alert-error" role="alert">อ่านสีของระบบไม่สำเร็จ · แสดงค่าเริ่มต้น</div>}
    <DisplaySettingsPanel canEdit={canEdit} palette={palette} onSave={async (next) => {
      await api.updateSystemSetting(token, UI_PALETTE_KEY, { value: JSON.stringify(next) });
      setPalette(next);
      applyUiPalette(next);
    }} />
  </>;
}
