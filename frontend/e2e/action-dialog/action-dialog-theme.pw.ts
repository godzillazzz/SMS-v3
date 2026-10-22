import { test, expect } from '@playwright/test';

function rgb(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`unexpected color ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrast(a: number[], b: number[]) {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: number[]) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
  const [bright, dim] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright + 0.05) / (dim + 0.05);
}

for (const theme of ['light', 'dark']) {
  test(`${theme} action dialog preserves geometry, tokens, and AA contrast`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/e2e/action-dialog/fixture.html?theme=${theme}`);
    await page.locator('.sms-action-dialog').waitFor({ state: 'visible' });

    await expect(page.locator('body > .sms-action-dialog-backdrop')).toHaveCount(1);
    await expect(page.locator('body > .sms-action-dialog-backdrop > .sms-action-dialog')).toHaveCount(1);
    await expect(page.locator('main.app-shell + .sms-action-dialog-backdrop')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('body')).not.toHaveClass(/app-shell/);
    await expect(page.locator('style')).toHaveCount(0);
    await expect(page.locator('[style]')).toHaveCount(0);

    const fixtureSource = await (await page.request.get('/e2e/action-dialog/fixture.html')).text();
    expect(fixtureSource).not.toMatch(/<style\b|\sstyle\s*=|--color-|\.sms-action-dialog\s*\{/i);

    const values = await page.locator('.sms-action-dialog').evaluate((node) => {
      const style = getComputedStyle(node);
      const message = getComputedStyle(node.querySelector('.sms-action-dialog__message')!);
      const context = getComputedStyle(node.querySelector('.sms-action-dialog__context')!);
      const heading = getComputedStyle(node.querySelector('h2')!);
      const headerLabel = getComputedStyle(node.querySelector('.sms-action-dialog__header p')!);
      const neutralButton = getComputedStyle(node.querySelector('.btn-neutral')!);
      const dangerButton = getComputedStyle(node.querySelector('.btn-danger')!);
      const tokenColor = (name: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        node.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      return {
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
        radius: style.borderTopLeftRadius,
        surface: style.backgroundColor,
        border: style.borderRightColor,
        heading: heading.color,
        message: message.color,
        context: context.color,
        headerLabel: headerLabel.color,
        neutralText: neutralButton.color,
        neutralSurface: neutralButton.backgroundColor,
        neutralBorder: neutralButton.borderRightColor,
        dangerText: dangerButton.color,
        dangerSurface: dangerButton.backgroundColor,
        dangerBorder: dangerButton.borderRightColor,
        tokens: {
          surface: tokenColor('--color-surface-elevated'),
          text: tokenColor('--color-text'),
          secondary: tokenColor('--color-text-secondary'),
          inverse: tokenColor('--color-text-inverse'),
          border: tokenColor('--color-border'),
          borderStrong: tokenColor('--color-border-strong'),
          primary: tokenColor('--color-primary'),
          danger: tokenColor('--color-danger')
        }
      };
    });

    console.log(`${theme} computed ${JSON.stringify(values)}`);

    expect(values.width).toBeLessThanOrEqual(520);
    expect(values.maxHeight).not.toBe('none');
    expect(values.overflowY).toBe('auto');
    expect(values.radius).toBe('18px');
    expect(values.height).toBeLessThanOrEqual(720);
    expect(values.scrollHeight).toBeGreaterThan(values.clientHeight);

    expect(values.surface).toBe(values.tokens.surface);
    expect(values.border).toBe(values.tokens.border);
    expect(values.heading).toBe(values.tokens.text);
    expect(values.context).toBe(values.tokens.text);
    expect(values.message).toBe(values.tokens.secondary);
    expect(values.headerLabel).toBe(values.tokens.primary);
    expect(values.neutralText).toBe(values.tokens.secondary);
    expect(values.neutralSurface).toBe(values.tokens.surface);
    expect(values.neutralBorder).toBe(values.tokens.borderStrong);
    expect(values.dangerText).toBe(values.tokens.inverse);
    expect(values.dangerSurface).toBe(values.tokens.danger);
    expect(values.dangerBorder).toBe(values.tokens.danger);

    expect(contrast(rgb(values.heading), rgb(values.surface))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(values.message), rgb(values.surface))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(values.headerLabel), rgb(values.surface))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(values.neutralText), rgb(values.neutralSurface))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(values.dangerText), rgb(values.dangerSurface))).toBeGreaterThanOrEqual(4.5);
  });
}