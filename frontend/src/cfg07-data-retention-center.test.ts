import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const panel = read('components/DataRetentionCenterPanel.tsx');
const client = read('data-retention-client.ts');
const main = read('main.tsx');
const css = read('styles/configuration-center.css');

describe('CFG-07 Data Retention Center', () => {
  it('mounts the governed Retention panel in Configuration Center', () => {
    expect(main).toContain("import { DataRetentionCenterPanel }");
    expect(main).toContain('<DataRetentionCenterPanel token={token} />');
    expect(panel).toContain('Data Retention Center / การเก็บรักษาข้อมูล');
    expect(panel).toContain('Asia/Bangkok');
  });

  it('shows the three Owner policy data classes and protected governance invariants', () => {
    for (const label of ['Operational / usage logs', 'Attendance raw events', 'Patrol / checkpoint raw scans']) {
      expect(panel).toContain(label);
    }
    expect(panel).toContain('Security/Governance Audit');
    expect(panel).toContain('Certified Attendance Summary');
    expect(panel).toContain('Correction');
    expect(panel).toContain('NOT_AVAILABLE');
  });

  it('requires preview before save and explicit acknowledgement for reductions', () => {
    expect(panel).toContain('ตรวจสอบผลกระทบ');
    expect(panel).toContain('preview.previewDigest');
    expect(panel).toContain('preview.reduction && !ackImpact');
    expect(panel).toContain('Safety Delay');
    expect(panel).toContain('24 ชั่วโมง');
    expect(panel).toContain('ตรวจสอบผลกระทบแล้ว และยืนยัน');
  });

  it('uses typed cancellation reason and no prompt-based governance', () => {
    expect(panel).toContain('เหตุผลที่ยกเลิก');
    expect(panel).toContain('cancelReason');
    expect(panel).not.toContain('window.prompt');
    expect(panel).not.toContain('prompt(');
  });

  it('requires explicit manual cleanup acknowledgement and bounded API call', () => {
    expect(panel).toContain('รัน Cleanup รอบถัดไป');
    expect(panel).toContain('cleanupAck');
    expect(panel).toContain('acknowledgeCleanup: true');
    expect(panel).toContain('batchSize: 200');
    expect(panel).toContain('maxBatches: 5');
  });

  it('client keeps all Retention operations behind dedicated no-store endpoints', () => {
    for (const endpoint of [
      '/retention-policies',
      '/retention-policies/preview',
      '/retention-policies/changes',
      '/retention-cleanup/run',
      '/retention-cleanup/runs'
    ]) expect(client).toContain(endpoint);
    expect(client).toContain("cache: 'no-store'");
    expect(client).toContain('Authorization: `Bearer ${token}`');
  });

  it('adds responsive Retention styles without a separate settings page', () => {
    expect(css).toContain('.retention-policy-grid');
    expect(css).toContain('.retention-ack');
    expect(css).toContain('@media(max-width:900px)');
    expect(css).toContain('@media(max-width:560px)');
  });
});
