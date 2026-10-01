export const ATTENDANCE_DEVICE_KEY_ALGORITHM = 'ECDSA_P256_SHA256' as const;
export const ATTENDANCE_DEVICE_KEY_DATABASE_NAME = 'smsv3-attendance-device-keys';
export const ATTENDANCE_DEVICE_KEY_DATABASE_VERSION = 1;
export const ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME = 'deviceKeys';
const DB_NAME = ATTENDANCE_DEVICE_KEY_DATABASE_NAME;
const DB_VERSION = ATTENDANCE_DEVICE_KEY_DATABASE_VERSION;
const STORE_NAME = ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME;

export type AttendanceDeviceKeyRecord = {
  candidateDeviceEnrollmentId: string;
  employeeId: string;
  privateKey: CryptoKey;
  publicKeySpkiBase64: string;
  createdAt: string;
};

export type AttendanceDeviceCapability = {
  supported: boolean;
  reason?: 'SECURE_CONTEXT_REQUIRED' | 'WEB_CRYPTO_UNAVAILABLE' | 'INDEXED_DB_UNAVAILABLE';
};

export type AttendanceDeviceKeyInspection = {
  enrollmentId: string;
  status: 'PRESENT' | 'MISSING' | 'INVALID' | 'UNAVAILABLE';
  algorithm: string | null;
  namedCurve: string | null;
  extractable: boolean | null;
  usages: string[];
  createdAt: string | null;
  errorCode?: 'INDEXED_DB_UNAVAILABLE' | 'MALFORMED_RECORD';
};

export type AttendanceDeviceKeyInventory = {
  available: boolean;
  enrollmentIds: string[];
  keys: AttendanceDeviceKeyInspection[];
  malformedRecordCount: number;
};

export class AttendanceDeviceKeyError extends Error {
  constructor(readonly code: 'ATTENDANCE_DEVICE_LOCAL_KEY_MISSING' | 'ATTENDANCE_DEVICE_LOCAL_KEY_INVALID' | 'ATTENDANCE_DEVICE_KEY_STORAGE_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'AttendanceDeviceKeyError';
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function attendanceDeviceCapability(): AttendanceDeviceCapability {
  if (typeof window === 'undefined' || !window.isSecureContext) return { supported: false, reason: 'SECURE_CONTEXT_REQUIRED' };
  if (!globalThis.crypto?.subtle) return { supported: false, reason: 'WEB_CRYPTO_UNAVAILABLE' };
  if (!globalThis.indexedDB) return { supported: false, reason: 'INDEXED_DB_UNAVAILABLE' };
  return { supported: true };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'candidateDeviceEnrollmentId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('ไม่สามารถเปิดพื้นที่เก็บคีย์ของอุปกรณ์ได้'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('ไม่สามารถเข้าถึงคีย์ของอุปกรณ์ได้'));
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('การจัดเก็บคีย์ของอุปกรณ์ถูกยกเลิก'));
      tx.onerror = () => reject(tx.error || new Error('ไม่สามารถบันทึกคีย์ของอุปกรณ์ได้'));
    });
  } finally {
    db.close();
  }
}

function isRecord(value: unknown): value is AttendanceDeviceKeyRecord {
  return Boolean(value && typeof value === 'object');
}

function inspectRecord(enrollmentId: string, value: unknown): AttendanceDeviceKeyInspection {
  if (value == null) {
    return { enrollmentId, status: 'MISSING', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null };
  }
  if (!isRecord(value)) {
    return { enrollmentId, status: 'INVALID', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null, errorCode: 'MALFORMED_RECORD' };
  }

  const rawKey = value.privateKey as unknown;
  const hasCryptoKeyConstructor = typeof globalThis.CryptoKey === 'function';
  const isCryptoKey = hasCryptoKeyConstructor && rawKey instanceof globalThis.CryptoKey;
  const key = (isCryptoKey ? rawKey : null) as CryptoKey | null;
  const algorithm = key?.algorithm && typeof key.algorithm === 'object' ? key.algorithm as KeyAlgorithm & { namedCurve?: string } : null;
  let usages: string[] = [];
  try {
    if (key?.usages && typeof key.usages[Symbol.iterator] === 'function') usages = Array.from(key.usages);
  } catch {
    usages = [];
  }
  const recordMatches = value.candidateDeviceEnrollmentId === enrollmentId
    && typeof value.employeeId === 'string'
    && value.employeeId.length > 0
    && typeof value.publicKeySpkiBase64 === 'string'
    && value.publicKeySpkiBase64.length > 0
    && typeof value.createdAt === 'string'
    && value.createdAt.length > 0;
  const keyMatches = Boolean(isCryptoKey && key
    && key.type === 'private'
    && key.extractable === false
    && algorithm?.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256'
    && usages.includes('sign'));
  const status = recordMatches && keyMatches ? 'PRESENT' : 'INVALID';
  return {
    enrollmentId,
    status,
    algorithm: algorithm?.name || null,
    namedCurve: algorithm?.namedCurve || null,
    extractable: typeof key?.extractable === 'boolean' ? key.extractable : null,
    usages,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    ...(status === 'INVALID' ? { errorCode: 'MALFORMED_RECORD' as const } : {})
  };
}

function unavailableInspection(enrollmentId: string): AttendanceDeviceKeyInspection {
  return { enrollmentId, status: 'UNAVAILABLE', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null, errorCode: 'INDEXED_DB_UNAVAILABLE' };
}

export async function inspectAttendanceDeviceKey(enrollmentId: string): Promise<AttendanceDeviceKeyInspection> {
  if (typeof enrollmentId !== 'string' || !enrollmentId.trim()) return { enrollmentId: '', status: 'INVALID', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null, errorCode: 'MALFORMED_RECORD' };
  try {
    const record = await withStore<AttendanceDeviceKeyRecord | undefined>('readonly', (store) => store.get(enrollmentId));
    return inspectRecord(enrollmentId, record);
  } catch {
    return unavailableInspection(enrollmentId);
  }
}

export async function hasAttendanceDeviceKey(enrollmentId: string) {
  return (await inspectAttendanceDeviceKey(enrollmentId)).status === 'PRESENT';
}

export async function listAttendanceDeviceKeyIds(employeeId?: string): Promise<AttendanceDeviceKeyInventory> {
  try {
    const rows = await withStore<AttendanceDeviceKeyRecord[]>('readonly', (store) => store.getAll());
    const matchingRows = (Array.isArray(rows) ? rows : []).filter((row) => !employeeId || (isRecord(row) && row.employeeId === employeeId));
    const keys = matchingRows.map((row) => {
      const enrollmentId = isRecord(row) && typeof row.candidateDeviceEnrollmentId === 'string' ? row.candidateDeviceEnrollmentId : '';
      return inspectRecord(enrollmentId, row);
    });
    return {
      available: true,
      enrollmentIds: keys.filter((key) => key.enrollmentId).map((key) => key.enrollmentId),
      malformedRecordCount: keys.filter((key) => key.status === 'INVALID').length,
      keys
    };
  } catch {
    return { available: false, enrollmentIds: [], malformedRecordCount: 0, keys: [] };
  }
}

export type AttendanceDeviceKeyIdChain = {
  activeDeviceId: string | null;
  candidateDeviceId: string | null;
  verificationDeviceId: string | null;
  storedEnrollmentIds: string[];
  activeKeyIdMatch: boolean | null;
  candidateKeyIdMatch: boolean | null;
  verificationKeyIdMatch: boolean | null;
  verificationMatchesActive: boolean | null;
};

export function correlateAttendanceDeviceKeyIds(input: {
  activeDeviceId?: string | null;
  candidateDeviceId?: string | null;
  verificationDeviceId?: string | null;
  storedEnrollmentIds: string[];
}): AttendanceDeviceKeyIdChain {
  const activeDeviceId = input.activeDeviceId || null;
  const candidateDeviceId = input.candidateDeviceId || null;
  const verificationDeviceId = input.verificationDeviceId || null;
  const storedEnrollmentIds = [...new Set(input.storedEnrollmentIds.filter(Boolean))];
  const stored = new Set(storedEnrollmentIds);
  return {
    activeDeviceId,
    candidateDeviceId,
    verificationDeviceId,
    storedEnrollmentIds,
    activeKeyIdMatch: activeDeviceId ? stored.has(activeDeviceId) : null,
    candidateKeyIdMatch: candidateDeviceId ? stored.has(candidateDeviceId) : null,
    verificationKeyIdMatch: verificationDeviceId ? stored.has(verificationDeviceId) : null,
    verificationMatchesActive: verificationDeviceId
      ? activeDeviceId ? verificationDeviceId === activeDeviceId : false
      : null
  };
}

export async function generateAttendanceDeviceKeyPair() {
  const capability = attendanceDeviceCapability();
  if (!capability.supported) throw new Error(capability.reason || 'ATTENDANCE_DEVICE_CRYPTO_UNAVAILABLE');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeySpki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeySpkiBase64: bytesToBase64(new Uint8Array(publicKeySpki)) };
}

export async function storeAttendanceDevicePrivateKey(candidateDeviceEnrollmentId: string, employeeId: string, privateKey: CryptoKey, publicKeySpkiBase64: string) {
  const record: AttendanceDeviceKeyRecord = { candidateDeviceEnrollmentId, employeeId, privateKey, publicKeySpkiBase64, createdAt: new Date().toISOString() };
  await withStore('readwrite', (store) => store.put(record));
  return record;
}

export async function getAttendanceDeviceKey(candidateDeviceEnrollmentId: string) {
  const record = await withStore<AttendanceDeviceKeyRecord | undefined>('readonly', (store) => store.get(candidateDeviceEnrollmentId));
  return record || null;
}

export async function deleteAttendanceDeviceKey(candidateDeviceEnrollmentId: string) {
  await withStore('readwrite', (store) => store.delete(candidateDeviceEnrollmentId));
}

export async function pruneAttendanceDeviceKeys(employeeId: string, allowedEnrollmentIds: string[]) {
  const allowed = new Set(allowedEnrollmentIds.filter(Boolean));
  const rows = await withStore<AttendanceDeviceKeyRecord[]>('readonly', (store) => store.getAll());
  const stale = (Array.isArray(rows) ? rows : []).filter((row) => isRecord(row)
    && row.employeeId === employeeId
    && typeof row.candidateDeviceEnrollmentId === 'string'
    && row.candidateDeviceEnrollmentId.length > 0
    && !allowed.has(row.candidateDeviceEnrollmentId));
  await Promise.all(stale.map((row) => deleteAttendanceDeviceKey(row.candidateDeviceEnrollmentId)));
  return stale.length;
}

export async function signAttendanceDeviceChallenge(candidateDeviceEnrollmentId: string, challenge: string) {
  let record: AttendanceDeviceKeyRecord | null;
  try {
    record = await getAttendanceDeviceKey(candidateDeviceEnrollmentId);
  } catch {
    throw new AttendanceDeviceKeyError('ATTENDANCE_DEVICE_KEY_STORAGE_UNAVAILABLE', 'ไม่สามารถอ่าน IndexedDB ของอุปกรณ์ใน browser/profile นี้ได้ จึงยังยืนยัน device proof ไม่ได้');
  }
  const inspection = inspectRecord(candidateDeviceEnrollmentId, record);
  if (inspection.status === 'MISSING') {
    throw new AttendanceDeviceKeyError('ATTENDANCE_DEVICE_LOCAL_KEY_MISSING', 'ไม่พบ local private key สำหรับ device enrollment ID ที่ Server ส่งมาใน browser/profile นี้');
  }
  if (inspection.status !== 'PRESENT' || !record?.privateKey) {
    throw new AttendanceDeviceKeyError('ATTENDANCE_DEVICE_LOCAL_KEY_INVALID', 'พบ record ของอุปกรณ์ แต่ key metadata ไม่ผ่านข้อกำหนด P-256 non-exportable; หยุดก่อนส่ง device proof');
  }
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, base64UrlToBytes(challenge));
  return bytesToBase64(new Uint8Array(signature));
}
