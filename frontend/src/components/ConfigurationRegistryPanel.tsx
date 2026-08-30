type SettingRow = {
  key?: unknown;
  value?: unknown;
  configured?: unknown;
  description?: unknown;
  updatedAt?: unknown;
  group?: unknown;
  groupLabel?: unknown;
  label?: unknown;
  valueType?: unknown;
  editable?: unknown;
  authority?: unknown;
  registryStatus?: unknown;
  constraints?: unknown;
};

function text(value: unknown, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function statusLabel(row: SettingRow) {
  if (row.registryStatus === 'PROTECTED') return 'Protected';
  if (row.registryStatus === 'UNREGISTERED') return 'Legacy · Read only';
  return row.configured ? 'Configured' : 'Default / Not set';
}

function constraintLabel(row: SettingRow) {
  const constraints = row.constraints && typeof row.constraints === 'object'
    ? row.constraints as Record<string, unknown>
    : {};
  if (Array.isArray(constraints.allowedValues)) return constraints.allowedValues.join(' · ');
  const parts = [];
  if (constraints.min !== undefined || constraints.max !== undefined) {
    parts.push(`${constraints.min ?? '—'}–${constraints.max ?? '—'}`);
  }
  if (constraints.unit) parts.push(String(constraints.unit));
  if (constraints.maxLength) parts.push(`max ${constraints.maxLength} chars`);
  return parts.join(' · ') || '—';
}

export function ConfigurationRegistryPanel({ settings }: { settings: SettingRow[] }) {
  const registered = settings.filter((row) => row.registryStatus === 'REGISTERED');
  const configured = registered.filter((row) => Boolean(row.configured));
  const legacy = settings.filter((row) => row.registryStatus === 'UNREGISTERED');
  const protectedRows = settings.filter((row) => row.registryStatus === 'PROTECTED');
  const groups = Array.from(new Map(
    registered.map((row) => [text(row.group), text(row.groupLabel, text(row.group))])
  ).entries());

  return <section className="configuration-registry" aria-label="Governed configuration registry">
    <div className="configuration-registry__intro">
      <div>
        <p className="eyebrow">GOVERNED CONFIGURATION</p>
        <h2>Configuration Registry</h2>
        <p>แก้ไขได้เฉพาะ key ที่ระบบ register และ validate ไว้แล้ว ส่วน legacy, secret และ operational settings เป็น read-only หรือใช้ protected workflow เท่านั้น</p>
      </div>
      <span className="record-chip">{registered.length} registered</span>
    </div>

    <div className="configuration-registry__metrics">
      <article><span>Registered</span><strong>{registered.length}</strong><small>{groups.length} domains</small></article>
      <article><span>Configured</span><strong>{configured.length}</strong><small>persisted values</small></article>
      <article><span>Legacy read-only</span><strong>{legacy.length}</strong><small>ไม่อนุญาต arbitrary PUT</small></article>
      <article><span>Protected</span><strong>{protectedRows.length}</strong><small>release / environment authority</small></article>
    </div>

    <div className="configuration-registry__domains">
      {groups.map(([id, label]) => {
        const rows = registered.filter((row) => text(row.group) === id);
        const configuredCount = rows.filter((row) => Boolean(row.configured)).length;
        return <div key={id} className="configuration-domain-chip">
          <strong>{label}</strong>
          <span>{configuredCount}/{rows.length} configured</span>
        </div>;
      })}
    </div>

    <div className="table-card configuration-registry__table">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Domain</th><th>Setting</th><th>Key</th><th>Type</th><th>Constraint</th><th>Status</th><th>Authority</th></tr>
          </thead>
          <tbody>
            {settings.length ? settings.map((row) => <tr key={text(row.key)}>
              <td>{text(row.groupLabel)}</td>
              <td><strong>{text(row.label, text(row.key))}</strong><small className="configuration-setting-description">{text(row.description)}</small></td>
              <td><code>{text(row.key)}</code></td>
              <td>{text(row.valueType)}</td>
              <td>{constraintLabel(row)}</td>
              <td><span className={`status-badge ${row.registryStatus === 'REGISTERED' ? (row.configured ? 'active' : 'pending') : 'inactive'}`}>{statusLabel(row)}</span></td>
              <td><code>{text(row.authority)}</code></td>
            </tr>) : <tr><td colSpan={7} className="no-rows">ยังไม่มี Configuration metadata</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <p className="configuration-registry__footnote">Registry นี้ไม่ใช่ secret store และไม่ใช่ deployment control plane; key ที่ยังไม่ได้ register จะไม่สามารถสร้างหรือแก้ผ่าน SystemSetting API ได้</p>
  </section>;
}
