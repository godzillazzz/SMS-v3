import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');

it('gates the initial approval summary behind a successful dashboard read', () => {
  const main = read('main.tsx');
  expect(main).toContain('const dashboardReadyRef = useRef<Promise<boolean> | null>(null);');
  expect(main).toContain('dashboardReadyRef.current = new Promise<boolean>');
  expect(main).toContain("if (activePage === 'dashboard')");
  expect(main).toContain('if (dashboardReady && !(await dashboardReady)) return;');
  expect(main).toContain('read: () => getApprovalCenterSummary(auth.token!)');
});
