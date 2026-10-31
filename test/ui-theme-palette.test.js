'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:***@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UI_THEME_PALETTE_KEY, DEFAULT_UI_THEME_PALETTE, PALETTE_FIELDS, contrastRatio, normalizeUiThemePalette, readUiThemePalette
} = require('../src/services/ui-theme-palette.service');
const { getSystemSettingDefinition, normalizeRegisteredSystemSettingValue, isSensitiveSystemSettingKey } = require('../src/services/system-setting-registry.service');
const { isBlockedWebConfigurationKey } = require('../src/services/system-setting-guardrail.service');

test('contrast ratio follows WCAG 2.x relative luminance', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(Math.round(contrastRatio('#ffffff', '#ffffff') * 100) / 100, 1);
  assert.ok(contrastRatio('#767676', '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
});

test('defaults are the approved mockup palette and all pass 4.5:1', () => {
  assert.deepEqual(Object.keys(DEFAULT_UI_THEME_PALETTE), PALETTE_FIELDS);
  assert.equal(DEFAULT_UI_THEME_PALETTE.primary, '#2563eb');
  assert.equal(normalizeUiThemePalette(JSON.stringify(DEFAULT_UI_THEME_PALETTE)), JSON.stringify(DEFAULT_UI_THEME_PALETTE));
});

test('sidebar options must maintain contrast against white sidebar text', () => {
  const badSidebar = {
    ...DEFAULT_UI_THEME_PALETTE,
    sidebarOptions: [
      { id: 'too-bright', label: 'สีเหลืองสว่างเกินไป', color: '#ffea79' }
    ]
  };
  assert.throws(() => normalizeUiThemePalette(JSON.stringify(badSidebar)), (err) => err.code === 'UI_THEME_CONTRAST_TOO_LOW');

  const goodSidebar = {
    ...DEFAULT_UI_THEME_PALETTE,
    sidebarOptions: [
      { id: 'custom-navy', label: 'น้ำเงินเข้มพิเศษ', color: '#102a43' },
      { id: 'custom-forest', label: 'เขียวป่าลึก', color: '#0b3d2e' }
    ]
  };
  const normalized = JSON.parse(normalizeUiThemePalette(JSON.stringify(goodSidebar)));
  assert.equal(normalized.sidebarOptions.length, 2);
  assert.equal(normalized.sidebarOptions[0].color, '#102a43');
});

test('palette validation rejects bad hex, missing/extra keys and low contrast (fail closed)', () => {
  const bad = (patch) => JSON.stringify({ ...DEFAULT_UI_THEME_PALETTE, ...patch });
  assert.throws(() => normalizeUiThemePalette('not json'), (error) => error.code === 'SYSTEM_SETTING_VALUE_INVALID');
  assert.throws(() => normalizeUiThemePalette(bad({ primary: 'red' })), (error) => error.code === 'SYSTEM_SETTING_VALUE_INVALID');
  assert.throws(() => normalizeUiThemePalette(bad({ extra: '#000000' })), (error) => error.code === 'SYSTEM_SETTING_VALUE_INVALID');
  const { danger, ...missing } = DEFAULT_UI_THEME_PALETTE;
  assert.throws(() => normalizeUiThemePalette(JSON.stringify(missing)), (error) => error.code === 'SYSTEM_SETTING_VALUE_INVALID');
  assert.throws(() => normalizeUiThemePalette(bad({ warning: '#ffd166' })), (error) => error.code === 'UI_THEME_CONTRAST_TOO_LOW' && /warning/.test(error.message));
  assert.equal(JSON.parse(normalizeUiThemePalette(bad({ primary: '#1D4ED8' }))).primary, '#1d4ed8');
});

test('palette key is a registered, editable, non-sensitive, non-blocked Admin setting', () => {
  const definition = getSystemSettingDefinition(UI_THEME_PALETTE_KEY);
  assert.ok(definition);
  assert.equal(definition.editable, true);
  assert.equal(definition.valueType, 'JSON');
  assert.equal(isSensitiveSystemSettingKey(UI_THEME_PALETTE_KEY), false);
  assert.equal(isBlockedWebConfigurationKey(UI_THEME_PALETTE_KEY), false);
  assert.throws(() => normalizeRegisteredSystemSettingValue(UI_THEME_PALETTE_KEY, JSON.stringify({ ...DEFAULT_UI_THEME_PALETTE, danger: '#ff9999' })), (error) => error.code === 'UI_THEME_CONTRAST_TOO_LOW');
});

test('public read returns stored palette or defaults, never throws on corrupt rows', async () => {
  const stored = { ...DEFAULT_UI_THEME_PALETTE, primary: '#1d4ed8' };
  const ok = await readUiThemePalette({ systemSetting: { findUnique: async ({ where }) => (assert.equal(where.key, UI_THEME_PALETTE_KEY), { value: JSON.stringify(stored), updatedAt: new Date('2026-10-31T00:00:00Z') }) } });
  assert.deepEqual(ok, { palette: stored, isDefault: false, updatedAt: '2026-10-31T00:00:00.000Z' });
  const none = await readUiThemePalette({ systemSetting: { findUnique: async () => null } });
  assert.deepEqual(none, { palette: DEFAULT_UI_THEME_PALETTE, isDefault: true, updatedAt: null });
  const corrupt = await readUiThemePalette({ systemSetting: { findUnique: async () => ({ value: '{"primary":"#fff"}' }) } });
  assert.equal(corrupt.isDefault, true);
});

test('GET /ui-theme is mounted for any authenticated role, while writes stay on ADMIN /system-settings', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/routes/operations.routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/ui-theme', async/);
  assert.ok(source.indexOf("router.get('/ui-theme'") > source.indexOf('router.use(authenticate);'));
  assert.match(source, /router\.put\('\/system-settings\/:key', authorize\('ADMIN'\)/);
});
