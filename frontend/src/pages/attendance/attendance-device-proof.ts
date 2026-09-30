import {
  AttendanceFlowError,
  attendanceDeviceState,
  verifyAttendanceDeviceProof,
  type AttendanceDeviceState,
  type AttendanceVerificationStart
} from './attendance-client';
import {
  AttendanceDeviceKeyError,
  correlateAttendanceDeviceKeyIds,
  listAttendanceDeviceKeyIds,
  signAttendanceDeviceChallenge,
  type AttendanceDeviceCapability,
  type AttendanceDeviceKeyIdChain,
  type AttendanceDeviceKeyInspection,
  type AttendanceDeviceKeyInventory
} from '../../lib/attendance-device-key';

export type CompleteAttendanceVerification = AttendanceVerificationStart & {
  sessionId: string;
  deviceEnrollmentId: string;
  challengeId: string;
  challenge: string;
  attendanceContext: NonNullable<AttendanceVerificationStart['attendanceContext']>;
};

export function isCompleteAttendanceVerification(
  verification: AttendanceVerificationStart | null
): verification is CompleteAttendanceVerification {
  if (!verification?.sessionId || !verification.deviceEnrollmentId || !verification.challengeId || !verification.challenge || !verification.attendanceContext) return false;
  return verification.verificationMode === 'GEOFENCE_ONLY_UAT' || Boolean(verification.activeChallenge);
}

export type AttendanceDeviceProofDiagnostics = {
  chain: AttendanceDeviceKeyIdChain;
  inspection: AttendanceDeviceKeyInspection | null;
  storageAvailable: boolean;
  serverActiveDeviceStatus: string | null;
};

export type AttendanceDeviceProofDependencies = {
  readDeviceState: (token: string) => Promise<AttendanceDeviceState>;
  readKeyInventory: (employeeId: string) => Promise<AttendanceDeviceKeyInventory>;
  signChallenge: (enrollmentId: string, challenge: string) => Promise<string>;
  postDeviceProof: (token: string, sessionId: string, input: { challengeId: string; challenge: string; signatureBase64: string }) => Promise<unknown>;
};

const productionDependencies: AttendanceDeviceProofDependencies = {
  readDeviceState: attendanceDeviceState,
  readKeyInventory: listAttendanceDeviceKeyIds,
  signChallenge: signAttendanceDeviceChallenge,
  postDeviceProof: verifyAttendanceDeviceProof
};

function inspectEnrollment(inventory: AttendanceDeviceKeyInventory, enrollmentId: string): AttendanceDeviceKeyInspection {
  if (!inventory.available) return { enrollmentId, status: 'UNAVAILABLE', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null, errorCode: 'INDEXED_DB_UNAVAILABLE' };
  return inventory.keys.find((key) => key.enrollmentId === enrollmentId)
    || { enrollmentId, status: 'MISSING', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null };
}

export async function performAttendanceDeviceProof(input: {
  token: string;
  requestId?: string;
  verification: CompleteAttendanceVerification;
  capability: AttendanceDeviceCapability;
  onDiagnostics?: (diagnostics: AttendanceDeviceProofDiagnostics, inventory: AttendanceDeviceKeyInventory) => void;
}, dependencies: AttendanceDeviceProofDependencies = productionDependencies): Promise<AttendanceDeviceProofDiagnostics> {
  const { token, requestId, verification, capability } = input;
  const currentDeviceState = await dependencies.readDeviceState(token);
  const inventory = await dependencies.readKeyInventory(currentDeviceState.employeeId);
  const chain = correlateAttendanceDeviceKeyIds({
    activeDeviceId: currentDeviceState.activeDevice?.id,
    candidateDeviceId: currentDeviceState.activeRequest?.candidateDeviceEnrollmentId,
    verificationDeviceId: verification.deviceEnrollmentId,
    storedEnrollmentIds: inventory.enrollmentIds
  });
  const verificationKey = inspectEnrollment(inventory, verification.deviceEnrollmentId);
  const diagnostics: AttendanceDeviceProofDiagnostics = {
    chain,
    inspection: verificationKey,
    storageAvailable: inventory.available,
    serverActiveDeviceStatus: currentDeviceState.activeDevice?.status || null
  };
  input.onDiagnostics?.(diagnostics, inventory);

  if (!capability.supported) {
    throw new AttendanceFlowError(
      `Browser runtime ยังไม่รองรับ secure Web Crypto / IndexedDB ที่ต้องใช้ทำ device proof (${capability.reason || 'unknown'}); verification ID=${chain.verificationDeviceId}. หยุดก่อน sign และก่อน device proof POST`,
      409,
      requestId,
      'ATTENDANCE_DEVICE_KEY_RUNTIME_UNAVAILABLE'
    );
  }
  if (currentDeviceState.activeDevice?.status !== 'ACTIVE' || chain.verificationMatchesActive !== true) {
    throw new AttendanceFlowError(
      `Device authority ไม่ตรงกันก่อนส่ง proof: Server active device ID=${chain.activeDeviceId || 'ไม่มี'} status=${currentDeviceState.activeDevice?.status || 'ไม่มี'}; verification.deviceEnrollmentId=${chain.verificationDeviceId || 'ไม่มี'}; candidate ID=${chain.candidateDeviceId || 'ไม่มี'}. ระบบหยุดก่อน device proof POST`,
      409,
      requestId,
      'ATTENDANCE_DEVICE_VERIFICATION_ID_MISMATCH'
    );
  }
  if (verificationKey.status === 'MISSING') {
    throw new AttendanceFlowError(
      `Server verification device ID=${chain.verificationDeviceId} แต่ browser/profile นี้ไม่มี IndexedDB private-key record สำหรับ ID นี้; activeDevice.id=${chain.activeDeviceId}; candidate ID=${chain.candidateDeviceId || 'ไม่มี'}; stored enrollment IDs=${chain.storedEnrollmentIds.join(', ') || 'ไม่มี'}. หยุดก่อน sign และก่อน device proof POST`,
      409,
      requestId,
      'ATTENDANCE_DEVICE_LOCAL_KEY_MISSING'
    );
  }
  if (verificationKey.status === 'INVALID') {
    throw new AttendanceFlowError(
      `พบ IndexedDB record สำหรับ verification device ID=${chain.verificationDeviceId} แต่ key metadata ไม่ผ่านข้อกำหนด; หยุดก่อน sign และก่อน device proof POST`,
      409,
      requestId,
      'ATTENDANCE_DEVICE_LOCAL_KEY_INVALID'
    );
  }
  if (!inventory.available || verificationKey.status === 'UNAVAILABLE') {
    throw new AttendanceFlowError(
      `อ่าน IndexedDB ใน browser/profile นี้ไม่ได้ จึงตรวจ local private key ของ verification device ID=${chain.verificationDeviceId} ก่อน sign ไม่ได้; หยุดก่อน device proof POST`,
      409,
      requestId,
      'ATTENDANCE_DEVICE_KEY_STORAGE_UNAVAILABLE'
    );
  }

  let signatureBase64: string;
  try {
    signatureBase64 = await dependencies.signChallenge(verification.deviceEnrollmentId, verification.challenge);
  } catch (error) {
    if (error instanceof AttendanceDeviceKeyError) throw new AttendanceFlowError(error.message, 409, requestId, error.code);
    throw error;
  }
  await dependencies.postDeviceProof(token, verification.sessionId, {
    challengeId: verification.challengeId,
    challenge: verification.challenge,
    signatureBase64
  });
  return diagnostics;
}
