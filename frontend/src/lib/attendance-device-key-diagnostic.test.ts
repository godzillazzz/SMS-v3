import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectAttendanceDeviceKeyStorageReadOnly } from './attendance-device-key-diagnostic';
import { ATTENDANCE_DEVICE_KEY_DATABASE_NAME, ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME } from './attendance-device-key';

function createRequest<T>(result: T) {
  const request = {
    result,
    error: null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null
  };
  queueMicrotask(() => request.onsuccess?.(new Event('success')));
  return request;
}

function createValidActiveRecord(enrollmentId: string) {
  class TestCryptoKey {}
  vi.stubGlobal('CryptoKey', TestCryptoKey);
  const privateKey = Object.assign(new TestCryptoKey(), {
    type: 'private',
    extractable: false,
    algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
    usages: ['sign']
  }) as unknown as CryptoKey;
  return {
    candidateDeviceEnrollmentId: enrollmentId,
    employeeId: 'employee-local-test',
    publicKeySpkiBase64: 'test-public-key-metadata',
    createdAt: '2026-10-01T00:00:00.000Z',
    privateKey
  };
}

function existingDatabaseFactory(ids: IDBValidKey[], activeRecord?: unknown) {
  const tx = {
    error: null,
    oncomplete: null as ((event: Event) => void) | null,
    onabort: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    objectStore: vi.fn(() => store)
  };
  const store = {
    keyPath: 'candidateDeviceEnrollmentId',
    getAllKeys: vi.fn(() => createRequest(ids)),
    get: vi.fn((enrollmentId: string) => {
      expect(enrollmentId).toBe('active-id');
      return createRequest(activeRecord);
    })
  };
  const database = {
    version: 1,
    objectStoreNames: { contains: (name: string) => name === ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME },
    transaction: vi.fn((name: string, mode: IDBTransactionMode) => {
      expect(name).toBe(ATTENDANCE_DEVICE_KEY_OBJECT_STORE_NAME);
      expect(mode).toBe('readonly');
      setTimeout(() => tx.oncomplete?.(new Event('complete')), 0);
      return tx;
    }),
    close: vi.fn()
  } as unknown as IDBDatabase;
  const request = {
    result: database,
    error: null,
    transaction: null,
    onupgradeneeded: null as ((event: Event) => void) | null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onblocked: null as ((event: Event) => void) | null
  };
  const factory = {
    databases: vi.fn().mockResolvedValue([{ name: ATTENDANCE_DEVICE_KEY_DATABASE_NAME, version: 1 }]),
    open: vi.fn(() => {
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
      return request;
    })
  } as unknown as IDBFactory & { databases: () => Promise<Array<{ name?: string; version?: number }>> };
  return { factory, store, database, request, tx };
}

describe('read-only Attendance device key storage diagnostic', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not open or create the database when enumeration says it is absent', async () => {
    const factory = {
      databases: vi.fn().mockResolvedValue([]),
      open: vi.fn()
    } as unknown as IDBFactory & { databases: () => Promise<Array<{ name?: string; version?: number }>> };

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(result.status).toBe('DATABASE_NOT_FOUND');
    expect(result.activePrivateKeyPresent).toBe(false);
    expect(factory.open).not.toHaveBeenCalled();
  });

  it('reads only primary keys in a readonly transaction and compares the supplied active ID', async () => {
    const { factory, store, database } = existingDatabaseFactory(
      ['active-id', 'candidate-id', 42],
      createValidActiveRecord('active-id')
    );

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(result).toMatchObject({
      status: 'READ_OK',
      databaseVersion: 1,
      objectStorePresent: true,
      keyPath: 'candidateDeviceEnrollmentId',
      storedEnrollmentIds: ['active-id', 'candidate-id'],
      activeDeviceId: 'active-id',
      activeRecordPresent: true,
      activePrivateKeyPresent: true,
      activeKeyStatus: 'PRESENT',
      activeKeyMetadata: {
        algorithm: 'ECDSA',
        namedCurve: 'P-256',
        extractable: false,
        usages: ['sign']
      }
    });
    expect(store.getAllKeys).toHaveBeenCalledOnce();
    expect(store.get).toHaveBeenCalledWith('active-id');
    expect(result).not.toHaveProperty('privateKey');
    expect(result.activeKeyMetadata).not.toHaveProperty('privateKey');
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('distinguishes an IDB record from a valid non-exportable P-256 signing key', async () => {
    const invalidRecord = {
      candidateDeviceEnrollmentId: 'active-id',
      employeeId: 'employee-local-test',
      publicKeySpkiBase64: 'test-public-key-metadata',
      createdAt: '2026-10-01T00:00:00.000Z',
      privateKey: { type: 'private', extractable: true }
    };
    const { factory } = existingDatabaseFactory(['active-id'], invalidRecord);

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(result.activeRecordPresent).toBe(true);
    expect(result.activePrivateKeyPresent).toBe(false);
    expect(result.activeKeyStatus).toBe('INVALID');
    expect(result.activeKeyMetadata).toMatchObject({ extractable: null });
    expect(result).not.toHaveProperty('privateKey');
  });

  it('fails closed without opening IndexedDB when safe database enumeration is unavailable', async () => {
    const factory = { open: vi.fn() } as unknown as IDBFactory;

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(result.status).toBe('SAFE_ENUMERATION_UNSUPPORTED');
    expect(factory.open).not.toHaveBeenCalled();
  });

  it('aborts if a database that was enumerated now requires an upgrade', async () => {
    let aborted = false;
    const request = {
      result: { close: vi.fn() },
      error: null,
      transaction: { abort: () => { aborted = true; } },
      onupgradeneeded: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null
    };
    const factory = {
      databases: vi.fn().mockResolvedValue([{ name: ATTENDANCE_DEVICE_KEY_DATABASE_NAME, version: 1 }]),
      open: vi.fn(() => {
        queueMicrotask(() => {
          request.onupgradeneeded?.(new Event('upgradeneeded'));
          request.onerror?.(new Event('error'));
        });
        return request;
      })
    } as unknown as IDBFactory & { databases: () => Promise<Array<{ name?: string; version?: number }>> };

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(aborted).toBe(true);
    expect(result.status).toBe('DATABASE_CHANGED_DURING_READ');
  });

  it('reports a missing active ID without reading any record value', async () => {
    const { factory, store } = existingDatabaseFactory(['another-device']);

    const result = await inspectAttendanceDeviceKeyStorageReadOnly('active-id', factory);

    expect(result.activePrivateKeyPresent).toBe(false);
    expect(store.get).not.toHaveBeenCalled();
  });
});
