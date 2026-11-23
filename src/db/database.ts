/**
 * IndexedDB 持久化 (idb 封装)
 * 库: gear-contact-sim, 版本化 schema
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { AssemblyError, GearPair } from '../gear/types';
import type { ModificationPlan } from '../gear/modification';
import type { SimulationRecord, PhotoRecord } from './records';

const DB_NAME = 'gear-contact-sim';
const DB_VERSION = 1;

export interface SchemaV1 {
  pairs: GearPair;
  plans: ModificationPlan;
  assemblies: AssemblyError;
  simulations: SimulationRecord;
  photos: PhotoRecord;
  settings: { id: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pairs')) {
          db.createObjectStore('pairs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('plans')) {
          const s = db.createObjectStore('plans', { keyPath: 'id' });
          s.createIndex('pairId', 'pairId');
        }
        if (!db.objectStoreNames.contains('assemblies')) {
          const s = db.createObjectStore('assemblies', { keyPath: 'id' });
          s.createIndex('pairId', 'pairId');
        }
        if (!db.objectStoreNames.contains('simulations')) {
          const s = db.createObjectStore('simulations', { keyPath: 'id' });
          s.createIndex('pairId', 'pairId');
        }
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('pairId', 'pairId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

type StoreName = keyof SchemaV1;

export async function putRecord<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  const db = await getDB();
  await db.put(store, value);
}

export async function getRecord<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(store, id) as Promise<T | undefined>;
}

export async function getAllRecords<T>(store: StoreName): Promise<T[]> {
  const db = await getDB();
  return db.getAll(store) as Promise<T[]>;
}

export async function deleteRecord(store: StoreName, id: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, id);
}

export async function listByPair<T>(store: 'plans' | 'assemblies' | 'simulations' | 'photos', pairId: string): Promise<T[]> {
  const db = await getDB();
  return db.getAllFromIndex(store, 'pairId', pairId) as Promise<T[]>;
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const stores = Array.from(db.objectStoreNames) as StoreName[];
  await Promise.all(stores.map((s) => db.clear(s)));
}
