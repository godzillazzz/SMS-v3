const DB_NAME = 'smsv3-attendance-simple';
const DB_VERSION = 1;
const STATE_STORE = 'state';
const QUEUE_STORE = 'queue';

type StoredDeviceIdentity = {
  id: 'deviceIdentity';
  privateKey: CryptoKey;
  publicKeySpkiBase64: string;
  keyAlgorithm: 'ECDSA_P256_SHA256';
  createdAt: string;
};

type StoredQueueKey = { id: 'queueKey'; key: CryptoKey; createdAt: string };
type StoredEncryptedBootstrap = { id: 'bootstrap'; ivBase64: string; ciphertextBase64: string; updatedAt: string };
type StoredQueueRecord = { captureId: string; ivBase64: string; ciphertextBase64: string; createdAt: string };

export type DeviceIdentity = Omit<StoredDeviceIdentity, 'id'>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'captureId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

async function readState<T>(id: string): Promise<T | null> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STATE_STORE, 'readonly');
    const result = await requestValue(tx.objectStore(STATE_STORE).get(id));
    return (result as T | undefined) || null;
  } finally {
    db.close();
  }
}

async function writeState(value: object): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STATE_STORE, 'readwrite');
    await requestValue(tx.objectStore(STATE_STORE).put(value));
  } finally {
    db.close();
  }
}

export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number in signed payload');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = (value as Record<string, unknown>)[key];
      if (next !== undefined) out[key] = canonicalize(next);
    }
    return out;
  }
  throw new Error('Unsupported value in signed payload');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensureDeviceIdentity(): Promise<DeviceIdentity> {
  if (!window.isSecureContext || !crypto?.subtle || !globalThis.indexedDB) throw new Error('อุปกรณ์นี้ไม่รองรับพื้นที่จัดเก็บคีย์ที่ปลอดภัย');
  const current = await readState<StoredDeviceIdentity>('deviceIdentity');
  if (current?.privateKey && current.publicKeySpkiBase64) {
    return {
      privateKey: current.privateKey,
      publicKeySpkiBase64: current.publicKeySpkiBase64,
      keyAlgorithm: current.keyAlgorithm,
      createdAt: current.createdAt
    };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const value: StoredDeviceIdentity = {
    id: 'deviceIdentity',
    privateKey: pair.privateKey,
    publicKeySpkiBase64: bytesToBase64(spki),
    keyAlgorithm: 'ECDSA_P256_SHA256',
    createdAt: new Date().toISOString()
  };
  await writeState(value);
  return {
    privateKey: value.privateKey,
    publicKeySpkiBase64: value.publicKeySpkiBase64,
    keyAlgorithm: value.keyAlgorithm,
    createdAt: value.createdAt
  };
}

export async function deviceFingerprint(identity: DeviceIdentity): Promise<string> {
  return sha256Hex(base64ToBytes(identity.publicKeySpkiBase64));
}

export async function signPayload(identity: DeviceIdentity, payload: unknown): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(canonicalJson(payload))
  ));
  return bytesToBase64(signature);
}

async function ensureQueueKey(): Promise<CryptoKey> {
  const current = await readState<StoredQueueKey>('queueKey');
  if (current?.key) return current.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await writeState({ id: 'queueKey', key, createdAt: new Date().toISOString() } satisfies StoredQueueKey);
  return key;
}

async function encryptJson(value: unknown): Promise<{ ivBase64: string; ciphertextBase64: string }> {
  const key = await ensureQueueKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return { ivBase64: bytesToBase64(iv), ciphertextBase64: bytesToBase64(encrypted) };
}

async function decryptJson<T>(encrypted: { ivBase64: string; ciphertextBase64: string }): Promise<T> {
  const key = await ensureQueueKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encrypted.ivBase64) as unknown as BufferSource },
    key,
    base64ToBytes(encrypted.ciphertextBase64) as unknown as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function storeEncryptedBootstrap<T>(value: T): Promise<void> {
  const encrypted = await encryptJson(value);
  await writeState({ id: 'bootstrap', ...encrypted, updatedAt: new Date().toISOString() } satisfies StoredEncryptedBootstrap);
}

export async function readEncryptedBootstrap<T>(): Promise<T | null> {
  const stored = await readState<StoredEncryptedBootstrap>('bootstrap');
  if (!stored) return null;
  return decryptJson<T>(stored);
}

export async function enqueueEncrypted<T extends { captureId: string }>(value: T): Promise<void> {
  const encrypted = await encryptJson(value);
  const db = await openDatabase();
  try {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    await requestValue(tx.objectStore(QUEUE_STORE).put({
      captureId: value.captureId,
      ...encrypted,
      createdAt: new Date().toISOString()
    } satisfies StoredQueueRecord));
  } finally {
    db.close();
  }
}

export async function listEncryptedQueue<T>(): Promise<Array<{ captureId: string; createdAt: string; value: T }>> {
  const db = await openDatabase();
  let rows: StoredQueueRecord[] = [];
  try {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    rows = (await requestValue(tx.objectStore(QUEUE_STORE).getAll())) as StoredQueueRecord[];
  } finally {
    db.close();
  }
  const values = await Promise.all(rows.map(async (row) => ({
    captureId: row.captureId,
    createdAt: row.createdAt,
    value: await decryptJson<T>(row)
  })));
  return values.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeQueued(captureId: string): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    await requestValue(tx.objectStore(QUEUE_STORE).delete(captureId));
  } finally {
    db.close();
  }
}

export async function encryptedQueueCount(): Promise<number> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    return await requestValue(tx.objectStore(QUEUE_STORE).count());
  } finally {
    db.close();
  }
}

export function deviceRiskSignals() {
  return {
    standalone: window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    secureContext: window.isSecureContext === true,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    webCrypto: Boolean(globalThis.crypto?.subtle),
    indexedDb: Boolean(globalThis.indexedDB),
    privateKeyNonExportable: true,
    automation: navigator.webdriver === true,
    integrityWarnings: [] as string[]
  };
}

export function gpsGeofenceDecision(site: { latitude: number; longitude: number; geofenceRadiusMeters: number }, location: { latitude: number; longitude: number; accuracyMeters: number }) {
  const radius = 6371008.8;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const phi1 = toRadians(site.latitude);
  const phi2 = toRadians(location.latitude);
  const deltaPhi = toRadians(location.latitude - site.latitude);
  const deltaLambda = toRadians(location.longitude - site.longitude);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const distanceMeters = radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const lowerBoundMeters = Math.max(0, distanceMeters - location.accuracyMeters);
  const upperBoundMeters = distanceMeters + location.accuracyMeters;
  const classification = upperBoundMeters <= site.geofenceRadiusMeters
    ? 'CONFIDENT_INSIDE'
    : lowerBoundMeters <= site.geofenceRadiusMeters ? 'BORDERLINE' : 'CONFIDENT_OUTSIDE';
  return { classification, distanceMeters, lowerBoundMeters, upperBoundMeters };
}
