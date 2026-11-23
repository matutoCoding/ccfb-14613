/**
 * 全局应用状态 (轻量发布订阅, 不引框架)
 */
import type { AssemblyError, GearPair } from '../gear/types';
import type { ModificationPlan } from '../gear/modification';
import type { SimulationRecord, PhotoRecord } from './records';
import { getAllRecords, putRecord, deleteRecord } from './database';

export interface AppState {
  pairs: GearPair[];
  plans: ModificationPlan[];
  assemblies: AssemblyError[];
  simulations: SimulationRecord[];
  photos: PhotoRecord[];
  currentPairId: string | null;
  currentPlanId: string | null;
  currentAssemblyId: string | null;
  currentSide: 'working' | 'nonworking';
  gpuAvailable: boolean;
  useGpu: boolean;
}

type Listener = (state: AppState) => void;

const state: AppState = {
  pairs: [],
  plans: [],
  assemblies: [],
  simulations: [],
  photos: [],
  currentPairId: null,
  currentPlanId: null,
  currentAssemblyId: null,
  currentSide: 'working',
  gpuAvailable: false,
  useGpu: true,
};

const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn({ ...state });
}

export async function refreshAll(): Promise<void> {
  const [pairs, plans, assemblies, simulations, photos] = await Promise.all([
    getAllRecords<GearPair>('pairs'),
    getAllRecords<ModificationPlan>('plans'),
    getAllRecords<AssemblyError>('assemblies'),
    getAllRecords<SimulationRecord>('simulations'),
    getAllRecords<PhotoRecord>('photos'),
  ]);
  state.pairs = pairs.sort((a, b) => b.updatedAt - a.updatedAt);
  state.plans = plans.sort((a, b) => b.updatedAt - a.updatedAt);
  state.assemblies = assemblies.sort((a, b) => b.updatedAt - a.updatedAt);
  state.simulations = simulations.sort((a, b) => b.createdAt - a.createdAt);
  state.photos = photos.sort((a, b) => b.createdAt - a.createdAt);
  if (!state.currentPairId && pairs[0]) state.currentPairId = state.currentPairId ?? pairs[0].id;
  // 自动选中当前齿轮副下的方案与误差(若当前选择已失效)
  const pid = state.currentPairId;
  if (pid) {
    const pairPlans = plans.filter((p) => p.pairId === pid);
    if (!state.currentPlanId || !pairPlans.some((p) => p.id === state.currentPlanId)) {
      state.currentPlanId = pairPlans[0]?.id ?? null;
    }
    const pairAsms = assemblies.filter((a) => a.pairId === pid);
    if (!state.currentAssemblyId || !pairAsms.some((a) => a.id === state.currentAssemblyId)) {
      state.currentAssemblyId = pairAsms[0]?.id ?? null;
    }
  }
  emit();
}

export async function savePair(pair: GearPair): Promise<void> {
  pair.updatedAt = Date.now();
  await putRecord('pairs', pair);
  await refreshAll();
}

export async function savePlan(plan: ModificationPlan): Promise<void> {
  plan.updatedAt = Date.now();
  await putRecord('plans', plan);
  await refreshAll();
}

export async function saveAssembly(asm: AssemblyError): Promise<void> {
  asm.updatedAt = Date.now();
  await putRecord('assemblies', asm);
  await refreshAll();
}

export async function saveSimulation(rec: SimulationRecord): Promise<void> {
  await putRecord('simulations', rec);
  await refreshAll();
}

export async function savePhoto(rec: PhotoRecord): Promise<void> {
  await putRecord('photos', rec);
  await refreshAll();
}

export async function remove(store: keyof AppState extends never ? never : 'pairs' | 'plans' | 'assemblies' | 'simulations' | 'photos', id: string): Promise<void> {
  await deleteRecord(store, id);
  await refreshAll();
}

export function selectPair(id: string | null): void {
  state.currentPairId = id;
  const plans = state.plans.filter((p) => p.pairId === id);
  const asms = state.assemblies.filter((a) => a.pairId === id);
  state.currentPlanId = plans[0]?.id ?? null;
  state.currentAssemblyId = asms[0]?.id ?? null;
  emit();
}

export function selectPlan(id: string | null): void {
  state.currentPlanId = id;
  emit();
}

export function selectAssembly(id: string | null): void {
  state.currentAssemblyId = id;
  emit();
}

export function setSide(side: 'working' | 'nonworking'): void {
  state.currentSide = side;
  emit();
}

export function setGpu(available: boolean, useIt: boolean): void {
  state.gpuAvailable = available;
  state.useGpu = useIt;
  emit();
}
