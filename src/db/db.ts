/**
 * IndexedDB 轻封装:齿轮副 / 修形方案 / 装配实测 三个仓库。
 */
import type { GearPairParams, ModificationSpec, AssemblyError } from '../core/types';

const DB_NAME = 'gear-contact-sim';
const DB_VERSION = 1;

export type StoreName = 'pairs' | 'mods' | 'assemblies';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pairs')) db.createObjectStore('pairs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('mods')) db.createObjectStore('mods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assemblies')) db.createObjectStore('assemblies', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

async function txAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const db = {
  pairs: {
    list: () => txAll<GearPairParams>('pairs'),
    get: (id: string) => tx<GearPairParams | undefined>('pairs', 'readonly', (s) => s.get(id) as IDBRequest<GearPairParams | undefined>),
    put: (v: GearPairParams) => tx<IDBValidKey>('pairs', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => tx<undefined>('pairs', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>),
  },
  mods: {
    list: () => txAll<ModificationSpec>('mods'),
    listFor: async (pairId: string) => (await txAll<ModificationSpec>('mods')).filter((m) => m.pairId === pairId),
    get: (id: string) => tx<ModificationSpec | undefined>('mods', 'readonly', (s) => s.get(id) as IDBRequest<ModificationSpec | undefined>),
    put: (v: ModificationSpec) => tx<IDBValidKey>('mods', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => tx<undefined>('mods', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>),
  },
  assemblies: {
    list: () => txAll<AssemblyError>('assemblies'),
    listFor: async (pairId: string) => (await txAll<AssemblyError>('assemblies')).filter((a) => a.pairId === pairId),
    get: (id: string) => tx<AssemblyError | undefined>('assemblies', 'readonly', (s) => s.get(id) as IDBRequest<AssemblyError | undefined>),
    put: (v: AssemblyError) => tx<IDBValidKey>('assemblies', 'readwrite', (s) => s.put(v)),
    delete: (id: string) => tx<undefined>('assemblies', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>),
  },
};
