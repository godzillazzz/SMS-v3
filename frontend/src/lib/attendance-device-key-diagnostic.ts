import {
  ATTENDANCE_DEVICE_KEY_DATABASE_NAME,
  ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME
} from './attendance-device-key';

export type AttendanceDeviceKeyStorageDiagnostic = {
  status:
    | 'READ_OK'
    | 'INDEXED_DB_UNAVAILABLE'
    | 'SAFE_ENUMERATION_UNSUPPORTED'
    | 'DATABASE_NOT_FOUND'
    | 'OBJECT_STORE_NOT_FOUND'
    | 'DATABASE_CHANGED_DURING_READ'
    | 'READ_FAILED';
  databaseName: string;
  databaseVersion: number | null;
  objectStoreName: string;
  objectStorePresent: boolean | null;
  keyPath: string | null;
  storedEnrollmentIds: string[];
  activeDeviceId: string | null;
  activeRecordPresent: boolean | null;
  activePrivateKeyPresent: boolean | null;
  activeKeyStatus: 'PRESENT' | 'MISSING' | 'INVALID' | 'NOT_CHECKED' | 'UNKNOWN';
  activeKeyMetadata: {
    algorithm: string | null;
    namedCurve: string | null;
    extractable: boolean | null;
    usages: string[];
  } | null;
};

type IndexedDbFactoryWithEnumeration = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string; version?: number }>>;
};

const emptyResult = (
  status: AttendanceDeviceKeyStorageDiagnostic['status'],
  activeDeviceId: string | null,
  objectStorePresent: boolean | null = null,
  activeRecordPresent: boolean | null = null,
  activePrivateKeyPresent: boolean | null = null,
  activeKeyStatus: AttendanceDeviceKeyStorageDiagnostic['activeKeyStatus'] = 'UNKNOWN',
  activeKeyMetadata: AttendanceDeviceKeyStorageDiagnostic['activeKeyMetadata'] = null
): AttendanceDeviceKeyStorageDiagnostic => ({
  status,
  databaseName: ATTENDANCE_DEVICE_KEY_DATABASE_NAME,
  databaseVersion: null,
  objectStoreName: ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME,
  objectStorePresent,
  keyPath: null,
  storedEnrollmentIds: [],
  activeDeviceId,
  activeRecordPresent,
  activePrivateKeyPresent,
  activeKeyStatus,
  activeKeyMetadata
});

function openExistingDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    let upgradeRequired = false;
    let blocked = false;

    request.onupgradeneeded = () => {
      upgradeRequired = true;
      // Abort instead of creating a database/store if it disappeared after enumeration.
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      if (upgradeRequired) {
        request.result.close();
        reject(new Error('DATABASE_CHANGED_DURING_READ'));
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(new Error(upgradeRequired ? 'DATABASE_CHANGED_DURING_READ' : 'READ_FAILED'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('READ_FAILED'));
    };
  });
}

function inspectActiveKeyRecord(value: unknown, enrollmentId: string) {
  if (value == null) {
    return {
      status: 'MISSING' as const,
      algorithm: null,
      namedCurve: null,
      extractable: null,
      usages: [] as string[]
    };
  }

  if (typeof value !== 'object') {
    return {
      status: 'INVALID' as const,
      algorithm: null,
      namedCurve: null,
      extractable: null,
      usages: [] as string[]
    };
  }

  const record = value as {
    candidateDeviceEnrollmentId?: unknown;
    employeeId?: unknown;
    publicKeySpkiBase64?: unknown;
    createdAt?: unknown;
    privateKey?: unknown;
  };
  const rawKey = record.privateKey;
  const hasCryptoKeyConstructor = typeof globalThis.CryptoKey === 'function';
  const isCryptoKey = hasCryptoKeyConstructor && rawKey instanceof globalThis.CryptoKey;
  const key = (isCryptoKey ? rawKey : null) as CryptoKey | null;
  const algorithm = key?.algorithm && typeof key.algorithm === 'object'
    ? key.algorithm as KeyAlgorithm & { namedCurve?: string }
    : null;
  let usages: string[] = [];
  try {
    if (key?.usages && typeof key.usages[Symbol.iterator] === 'function') usages = Array.from(key.usages);
  } catch {
    usages = [];
  }

  const recordMatches = record.candidateDeviceEnrollmentId === enrollmentId
    && typeof record.employeeId === 'string'
    && record.employeeId.length > 0
    && typeof record.publicKeySpkiBase64 === 'string'
    && record.publicKeySpkiBase64.length > 0
    && typeof record.createdAt === 'string'
    && record.createdAt.length > 0;
  const algorithmName = algorithm?.name || null;
  const namedCurve = algorithm?.namedCurve || null;
  const extractable = typeof key?.extractable === 'boolean' ? key.extractable : null;
  const keyValid = Boolean(isCryptoKey && key
    && key.type === 'private'
    && key.extractable === false
    && algorithmName === 'ECDSA'
    && namedCurve === 'P-256'
    && usages.includes('sign'));

  return {
    status: recordMatches && keyValid ? 'PRESENT' as const : 'INVALID' as const,
    algorithm: algorithmName,
    namedCurve,
    extractable,
    usages
  };
}

function readPrimaryKeysAndActiveRecord(database: IDBDatabase, objectStoreName: string, activeDeviceId: string | null) {
  return new Promise<{ keyPath: string | null; keys: IDBValidKey[]; activeRecord: unknown }>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(objectStoreName, 'readonly');
    } catch {
      reject(new Error('READ_FAILED'));
      return;
    }

    const store = transaction.objectStore(objectStoreName);
    const keyPath = typeof store.keyPath === 'string' ? store.keyPath : null;
    let keys: IDBValidKey[] = [];
    let activeRecord: unknown;

    try {
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keys = Array.isArray(keysRequest.result) ? keysRequest.result : [];
        if (activeDeviceId && keys.includes(activeDeviceId)) {
          const recordRequest = store.get(activeDeviceId);
          recordRequest.onsuccess = () => {
            // Keep the record/CryptoKey in this function; only safe metadata leaves it.
            activeRecord = recordRequest.result;
          };
          recordRequest.onerror = () => reject(recordRequest.error || new Error('READ_FAILED'));
        }
      };
      keysRequest.onerror = () => reject(keysRequest.error || new Error('READ_FAILED'));
    } catch {
      reject(new Error('READ_FAILED'));
      return;
    }

    transaction.oncomplete = () => resolve({ keyPath, keys, activeRecord });
    transaction.onabort = () => reject(transaction.error || new Error('READ_FAILED'));
    transaction.onerror = () => reject(transaction.error || new Error('READ_FAILED'));
  });
}

/**
 * Reads database metadata and object-store primary keys in a read-only transaction. If the
 * supplied active ID exists, its one record is inspected in memory for safe CryptoKey metadata.
 * Private key material is never exported, serialized, logged, sent, written, or deleted.
 * This helper never upgrades or creates a database.
 */
export async function inspectAttendanceDeviceKeyStorageReadOnly(
  activeDeviceId?: string | null,
  factory?: IDBFactory
): Promise<AttendanceDeviceKeyStorageDiagnostic> {
  const normalizedActiveId = activeDeviceId?.trim() || null;
  let availableFactory = factory;
  try {
    availableFactory ||= globalThis.indexedDB;
  } catch {
    return emptyResult('INDEXED_DB_UNAVAILABLE', normalizedActiveId);
  }
  if (!availableFactory) return emptyResult('INDEXED_DB_UNAVAILABLE', normalizedActiveId);

  const factoryWithEnumeration = availableFactory as IndexedDbFactoryWithEnumeration;
  if (typeof factoryWithEnumeration.databases !== 'function') {
    // Opening a missing database may create it, so do not fall back to open().
    return emptyResult('SAFE_ENUMERATION_UNSUPPORTED', normalizedActiveId);
  }

  let databaseInfo: Array<{ name?: string; version?: number }>;
  try {
    databaseInfo = await factoryWithEnumeration.databases();
  } catch {
    return emptyResult('INDEXED_DB_UNAVAILABLE', normalizedActiveId);
  }

  const knownDatabase = databaseInfo.find((item) => item.name === ATTENDANCE_DEVICE_KEY_DATABASE_NAME);
  if (!knownDatabase) return emptyResult(
    'DATABASE_NOT_FOUND',
    normalizedActiveId,
    false,
    normalizedActiveId ? false : null,
    normalizedActiveId ? false : null,
    normalizedActiveId ? 'MISSING' : 'NOT_CHECKED'
  );

  let database: IDBDatabase | undefined;
  let databaseVersion: number | null = null;
  let objectStorePresent: boolean | null = null;
  try {
    database = await openExistingDatabase(availableFactory, ATTENDANCE_DEVICE_KEY_DATABASE_NAME);
    databaseVersion = database.version;
    objectStorePresent = database.objectStoreNames.contains(ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME);
    if (!objectStorePresent) {
      return {
        ...emptyResult(
          'OBJECT_STORE_NOT_FOUND',
          normalizedActiveId,
          false,
          normalizedActiveId ? false : null,
          normalizedActiveId ? false : null,
          normalizedActiveId ? 'MISSING' : 'NOT_CHECKED'
        ),
        databaseVersion
      };
    }

    const { keyPath, keys, activeRecord } = await readPrimaryKeysAndActiveRecord(database, ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME, normalizedActiveId);
    const storedEnrollmentIds = keys.filter((key): key is string => typeof key === 'string').sort();
    const activeKey = normalizedActiveId ? inspectActiveKeyRecord(activeRecord, normalizedActiveId) : null;
    return {
      status: 'READ_OK',
      databaseName: ATTENDANCE_DEVICE_KEY_DATABASE_NAME,
      databaseVersion,
      objectStoreName: ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME,
      objectStorePresent: true,
      keyPath,
      storedEnrollmentIds,
      activeDeviceId: normalizedActiveId,
      activeRecordPresent: normalizedActiveId ? activeRecord != null : null,
      activePrivateKeyPresent: activeKey ? activeKey.status === 'PRESENT' : null,
      activeKeyStatus: activeKey?.status || 'NOT_CHECKED',
      activeKeyMetadata: activeKey ? {
        algorithm: activeKey.algorithm,
        namedCurve: activeKey.namedCurve,
        extractable: activeKey.extractable,
        usages: activeKey.usages
      } : null
    };
  } catch (error) {
    const status = error instanceof Error && error.message === 'DATABASE_CHANGED_DURING_READ'
      ? 'DATABASE_CHANGED_DURING_READ'
      : 'READ_FAILED';
    return {
      ...emptyResult(status, normalizedActiveId, objectStorePresent, null, null),
      databaseVersion
    };
  } finally {
    database?.close();
  }
}
