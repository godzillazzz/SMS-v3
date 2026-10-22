import { test, expect } from '@playwright/test';

const light = {
  surface: 'rgb(255, 255, 255)',
  text: 'rgb(31, 41, 55)',
  secondary: 'rgb(91, 102, 117)',
  border: 'rgb(227, 232, 239)',
  primary: 'rgb(30, 58, 95)',
  danger: 'rgb(185, 28, 28)'
};
const dark = {
  surface: 'rgb(22, 30, 48)',
  text: 'rgb(243, 244, 246)',
  secondary: 'rgb(182, 191, 210)',
  border: 'rgb(59, 71, 99)',
  primary: 'rgb(139, 124, 246)',
  danger: 'rgb(248, 113, 113)'
};

function hex(rgb: string) {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`unexpected color ${rgb}`);
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

for (const [theme, expected] of Object.entries({ light, dark })) {
  test(`${theme} action dialog uses computed theme tokens and AA contrast`, async ({ page }) => {
    await page.goto('/e2e/action-dialog/fixture.html');
    await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
    const values = await page.locator('.sms-action-dialog').evaluate((node) => {
      const style = getComputedStyle(node);
      const message = getComputedStyle(node.querySelector('.sms-action-dialog__message')!);
      const heading = getComputedStyle(node.querySelector('h2')!);
      return {
        surface: style.backgroundColor,
        text: heading.color,
        secondary: message.color,
        border: style.borderRightColor,
        primary: getComputedStyle(node.querySelector('.sms-action-dialog__header p')!).color
      };
    });
    expect(values.surface).toBe(expected.surface);
    expect(values.text).toBe(expected.text);
    expect(values.secondary).toBe(expected.secondary);
    expect(values.border).toBe(expected.border);
    expect(values.primary).toBe(expected.primary);
    const background = hex(values.surface);
    expect(contrast(hex(values.text), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(values.secondary), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(values.primary), background)).toBeGreaterThanOrEqual(4.5);
  });
}
