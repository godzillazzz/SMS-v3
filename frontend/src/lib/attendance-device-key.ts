export const ATTENDANCE_DEVICE_KEY_ALGORITHM = 'ECDSA_P256_SHA256' as const;
const DB_NAME = 'smsv3-attendance-device-keys';
const DB_VERSION = 1;
const STORE_NAME = 'deviceKeys';

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
  const stale = rows.filter((row) => row.employeeId === employeeId && !allowed.has(row.candidateDeviceEnrollmentId));
  await Promise.all(stale.map((row) => deleteAttendanceDeviceKey(row.candidateDeviceEnrollmentId)));
  return stale.length;
}

export async function signAttendanceDeviceChallenge(candidateDeviceEnrollmentId: string, challenge: string) {
  const record = await getAttendanceDeviceKey(candidateDeviceEnrollmentId);
  if (!record?.privateKey) throw new Error('ไม่พบคีย์ส่วนตัวของอุปกรณ์นี้ในเบราว์เซอร์ กรุณายกเลิกคำขอและลงทะเบียนใหม่จากอุปกรณ์ที่ต้องการใช้งาน');
  if (record.privateKey.extractable) throw new Error('คีย์ของอุปกรณ์ไม่ผ่านข้อกำหนดความปลอดภัย');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, base64UrlToBytes(challenge));
  return bytesToBase64(new Uint8Array(signature));
}
