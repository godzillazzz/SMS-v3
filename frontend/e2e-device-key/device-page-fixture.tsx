import React from 'react';
import { createRoot } from 'react-dom/client';
import { AttendanceDevicePage } from '../src/pages/attendance-device/AttendanceDevicePage';
import { generateAttendanceDeviceKeyPair, storeAttendanceDevicePrivateKey } from '../src/lib/attendance-device-key';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/styles/responsive-shell.css';
import '../src/styles/attendance-device.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('fixture root element is missing');
const root = createRoot(rootElement);
const dbName = 'smsv3-attendance-device-keys';
const employeeId = 'browser-ui-employee';
const activeId = 'browser-ui-active-device';
const candidateId = 'browser-ui-candidate-device';

function clearDb() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('deleteDatabase failed'));
  });
}

async function storeKey(enrollmentId: string) {
  const material = await generateAttendanceDeviceKeyPair();
  await storeAttendanceDevicePrivateKey(enrollmentId, employeeId, material.privateKey, material.publicKeySpkiBase64);
}

const activeDevice = {
  id: activeId,
  employeeId,
  displayName: 'Browser test iPhone',
  keyAlgorithm: 'ECDSA_P256_SHA256',
  platformHint: 'iPhone',
  status: 'ACTIVE' as const,
  activatedAt: '2026-09-01T00:00:00.000Z',
  approvedBy: { id: 'browser-ui-admin', displayName: 'Admin' }
};

(window as any).devicePageFixture = {
  async mount({ activeKey, candidateKey = false }: { activeKey: boolean; candidateKey?: boolean }) {
    await clearDb();
    if (activeKey) await storeKey(activeId);
    const activeRequest = candidateKey ? {
      id: 'browser-ui-request',
      employeeId,
      requestType: 'REPLACEMENT',
      status: 'PENDING_APPROVAL',
      requestedByUserId: 'browser-ui-user',
      candidateDeviceEnrollmentId: candidateId,
      createdAt: '2026-09-01T00:00:00.000Z',
      candidateDevice: { ...activeDevice, id: candidateId, displayName: 'Candidate iPhone', status: 'PENDING_APPROVAL', proofVerifiedAt: null }
    } : null;
    if (candidateKey) await storeKey(candidateId);
    root.render(<AttendanceDevicePage token="browser-fixture-token" role="EMPLOYEE" />);
    return { employeeId, activeDevice, activeRequest };
  }
};
