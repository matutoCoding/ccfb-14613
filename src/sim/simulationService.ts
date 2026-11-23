/**
 * 仿真服务: 统一编排 几何->误差->GPU/CPU 间隙场->着色->加载->TE->记录
 */
import type { FlankSide, LoadCase } from '../gear/types';
import type { GearPair, AssemblyError } from '../gear/types';
import { derivePair, type PairDerived } from '../gear/pair';
import type { ModificationPlan } from '../gear/modification';
import { effectiveErrors } from '../gear/assembly';
import {
  runTca,
  simulateRotation,
  transmissionError,
  summarizePattern,
} from '../gear/tca';
import { runLoadedCases } from '../gear/loaded';
import { patternFeatures } from '../gear/inverse';
import type { SimulationRecord } from '../db/records';
import { GpuEngine, computeGrid } from './gpuEngine';
import { uid } from '../gear/types';

export interface SimOptions {
  nS?: number;
  nZ?: number;
  steps?: number;
  load?: LoadCase;
  useGpu?: boolean;
}

export interface SimOutput {
  derived: PairDerived;
  record: SimulationRecord;
  gpuUsed: boolean;
  elapsedMs: number;
}

export class SimulationService {
  private engine: GpuEngine | null = null;
  private gpuChecked = false;

  async getEngine(): Promise<GpuEngine | null> {
    if (!this.gpuChecked) {
      this.gpuChecked = true;
      this.engine = await GpuEngine.create();
    }
    return this.engine;
  }

  get gpuAvailable(): boolean {
    return this.engine !== null;
  }

  async run(
    pair: GearPair,
    plan: ModificationPlan,
    asm: AssemblyError,
    side: FlankSide,
    opts: SimOptions = {},
  ): Promise<SimOutput> {
    const t0 = performance.now();
    const nS = opts.nS ?? 48;
    const nZ = opts.nZ ?? 48;
    const steps = opts.steps ?? 120;
    const load = opts.load;
    const derived = derivePair(pair);
    const eff = effectiveErrors(pair, derived, asm);

    const engine = opts.useGpu === false ? null : await this.getEngine();
    const grid = await computeGrid(engine, derived, plan, side, eff, nS, nZ);
    const gpuUsed = engine !== null && opts.useGpu !== false;

    const pattern = simulateRotation(grid, plan.redLeadThickness);
    const teRes = transmissionError(derived, grid, steps);
    const loaded = runLoadedCases(derived, grid, load ?? {
      torqueNm: 500,
      rpm: 1500,
      elasticModulus: 2.06e5,
      poissonRatio: 0.3,
      allowableStress: 1200,
    });

    const elapsedMs = performance.now() - t0;
    const record: SimulationRecord = {
      id: uid('sim'),
      name: `${pair.name} / ${plan.name} / ${side === 'working' ? '工作面' : '非工作面'}`,
      createdAt: Date.now(),
      pairId: pair.id,
      planId: plan.id,
      assemblyId: asm.id,
      side,
      clearance: Array.from(grid.clearance),
      intensity: Array.from(pattern.intensity),
      pressureFull: Array.from(loaded.full.pressure),
      pressureLight: Array.from(loaded.light.pressure),
      nS,
      nZ,
      sAxis: Array.from(grid.s),
      zAxis: Array.from(grid.zeta),
      te: teRes.points,
      tePeakToPeak: teRes.pp,
      teMeshAmplitude: teRes.meshAmp,
      maxStress: loaded.full.maxStress,
      loadDistributionFactor: loaded.full.loadDistributionFactor,
      redZones: loaded.full.redZones,
      features: patternFeatures(pattern),
    };

    return { derived, record, gpuUsed, elapsedMs };
  }

  /** 轻量入口: 只跑 TCA(测试/快速预览用) */
  runCpu(pair: GearPair, plan: ModificationPlan, asm: AssemblyError, side: FlankSide) {
    const derived = derivePair(pair);
    const eff = effectiveErrors(pair, derived, asm);
    return { derived, result: runTca(derived, plan, side, eff) };
  }
}

export const simulationService = new SimulationService();
export { summarizePattern };
