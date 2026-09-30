'use strict';

const assert = require('node:assert/strict');
const { chromium, webkit } = require('../../node_modules/playwright');

const engineName = process.argv[2] || 'chromium';
const requestedWidths = process.argv[3] ? process.argv[3].split(',').map(Number) : [390, 320, 1280];
const baseUrl = process.argv[4] || 'http://127.0.0.1:4173/test-harnesses/access-management-focus.html';
const engine = engineName === 'webkit' ? webkit : chromium;

(async () => {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of requestedWidths) {
      console.log(`${engineName} ${width}px: starting`);
      const page = await browser.newPage({
        viewport: { width, height: 850 },
        isMobile: width < 600,
        hasTouch: width < 600,
        deviceScaleFactor: width < 600 ? 2 : 1
      });
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'รายละเอียด' }).click();
      const menuTrigger = page.getByRole('button', { name: /การทำงานเพิ่มเติมสำหรับบัญชี/ });
      await menuTrigger.click();
      const resetAction = page.getByRole('menuitem', { name: 'รีเซ็ตรหัสผ่าน' });
      await resetAction.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => Boolean(document.querySelector('input[type="password"]')), undefined, { timeout: 5000 }).catch(() => {});
      const dialogCount = await page.getByRole('dialog').count();
      console.log(`${engineName} ${width}px: after menu activation, dialogs=${dialogCount}`);

      const dialog = page.getByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' });
      const input = dialog.locator('input[type="password"]');
      await input.focus();
      const dialogHandle = await dialog.elementHandle();
      assert.ok(dialogHandle, `${engineName} ${width}px: reset dialog did not open`);

      let typed = '';
      for (const character of 'Ab12cd34') {
        await page.keyboard.type(character);
        typed += character;
        const state = await page.evaluate(() => ({
          focused: document.activeElement?.getAttribute('type') === 'password' && document.activeElement === document.querySelector('input[type="password"]'),
          value: document.querySelector('input[type="password"]')?.value,
          connected: document.querySelector('input[type="password"]')?.isConnected,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth
        }));
        assert.equal(state.focused, true, `${engineName} ${width}px: password input lost focus after ${typed.length} character(s)`);
        assert.equal(state.value, typed, `${engineName} ${width}px: typed value changed after ${typed.length} character(s)`);
        assert.equal(state.connected, true, `${engineName} ${width}px: password input was disconnected after ${typed.length} character(s)`);
        assert.equal(await dialog.evaluate((element) => element.isConnected), true, `${engineName} ${width}px: dialog was removed during typing`);
        assert.equal(await page.evaluate((element) => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) === element, dialogHandle), true, `${engineName} ${width}px: dialog remounted during typing`);
      }

      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      const menuTriggerHandle = await menuTrigger.elementHandle();
      await page.waitForFunction((trigger) => document.activeElement === trigger, menuTriggerHandle, { timeout: 3000 });
      const focusRestored = await menuTrigger.evaluate((element) => document.activeElement === element);
      const activeFocus = focusRestored ? null : await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label'),
        text: document.activeElement?.textContent?.trim().slice(0, 80),
        connected: document.activeElement?.isConnected
      }));
      assert.equal(focusRestored, true, `${engineName} ${width}px: Escape did not restore focus to the menu trigger (${JSON.stringify(activeFocus)})`);
      assert.deepEqual(pageErrors, [], `${engineName} ${width}px: browser page errors`);
      const dimensions = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        outerWidth: window.outerWidth,
        screenWidth: window.screen.width,
        visualViewportScale: window.visualViewport?.scale,
        devicePixelRatio: window.devicePixelRatio
      }));
      console.log(JSON.stringify({ engine: engineName, width, typedCharacters: typed.length, focusRetained: true, dialogRemounted: false, escapeFocusRestored: true, ...dimensions }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
