import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(relative: string) {
  return fs.readFileSync(path.join(__dirname, relative), 'utf8');
}

describe('Request ID visibility representative flow wiring', () => {
  it('Employee Lifecycle preserves structured API error metadata and renders the shared reference UI', () => {
    const lifecycle = source('components/personnel/EmployeeLifecycleModal.tsx');
    expect(lifecycle).toContain("toRequestErrorState(reasonValue, 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ')");
    expect(lifecycle).toContain('<RequestErrorContent error={error} />');
    expect(lifecycle).not.toContain("'\\nรหัสอ้างอิง: '");
  });

  it('License document failures preserve structured request IDs for upload/review/view errors', () => {
    const license = source('components/LicenseDocuments.tsx');
    expect(license).toContain('const licenseRequestError = (reason: unknown) => toRequestErrorState');
    expect(license).toContain('setReviewError(licenseRequestError(reason))');
    expect(license).toContain('<RequestErrorContent error={error} />');
    expect(license).toContain('<RequestErrorContent error={reviewError} />');
  });

  it('Report Center and Executive Report preserve request IDs instead of replacing API errors with plain strings', () => {
    const reportCenter = source('pages/reports/ReportCenterPage.tsx');
    const executive = source('pages/executive-report/ExecutiveReportCenterPage.tsx');
    for (const code of [reportCenter, executive]) {
      expect(code).toContain('toRequestErrorState(reason');
      expect(code).toContain('<RequestErrorContent error=');
    }
    expect(reportCenter).not.toContain('.catch(() =>');
    expect(executive).not.toContain('.catch(() =>');
  });

  it('shared Schedule/Leave mutation paths retain structured request IDs', () => {
    const main = source('main.tsx');
    expect(main).toContain("setOperationError(toRequestErrorState(reason, 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ'))");
    expect(main).toContain("setSubmitError(toRequestErrorState(reason, 'ส่งคำขอลาไม่สำเร็จ'))");
    expect(main).toContain("setEditorError(toRequestErrorState(reason, 'บันทึกข้อมูลไม่สำเร็จ'))");
  });
});
