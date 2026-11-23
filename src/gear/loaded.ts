/**
 * 加载接触分析 (LTCA)
 * 线性柔度模型: 接触格点法向变形 δk = Ck·Fk, 平衡 δk = δ0 - gk (gk<δ0 时接触)
 * 二分刚体趋近量 δ0 使 ΣFk = 总法向载荷
 */
import type { LoadCase } from './types';
import type { PairDerived } from './pair';
import type { TcaGrid, ContactPattern } from './tca';
import { summarizePattern } from './tca';

export interface LoadedCell {
  index: number;
  force: number; // N
  pressure: number; // MPa
  stress: number; // MPa (Hertz 接触应力)
  edgeConcentration: boolean;
}

export interface LoadedResult {
  /** 压力场 MPa, 同网格 */
  pressure: Float64Array;
  /** 变形场 mm */
  deformation: Float64Array;
  cells: LoadedCell[];
  totalForce: number;
  maxStress: number;
  /** 应力超标/齿端集中格点索引 */
  redZones: number[];
  pattern: ContactPattern;
  /** 载荷沿齿宽分布不均匀系数 Kβ */
  loadDistributionFactor: number;
}

/** 小轮扭矩 -> 总法向载荷 (N) */
export function totalNormalForce(derived: PairDerived, torqueNm: number): number {
  const d1 = derived.d1;
  const radius = d1.r;
  const alphaT = d1.alphaT;
  const beta = derived.pinionV.helixAngle;
  // Ft = T/r; Fn = Ft / (cos αt · cos β)
  const ft = (torqueNm * 1000) / radius;
  return ft / (Math.cos(alphaT) * Math.cos(beta || 0));
}

/**
 * 求解载荷分布
 * @param grid TCA 间隙+柔度网格
 * @param targetForce 目标总法向力 N
 */
export function solveLoaded(
  derived: PairDerived,
  grid: TcaGrid,
  load: LoadCase,
  targetForce: number,
): LoadedResult {
  const { nS, nZ, clearance, compliance, s, zeta } = grid;
  const N = clearance.length;
  const force = new Float64Array(N);
  const deformation = new Float64Array(N);
  const pressure = new Float64Array(N);

  // 估算格点代表的齿面面积 (mm²): 作用线步长 × 齿宽步长
  const ds = nS > 1 ? s[1] - s[0] : 1;
  const dz = nZ > 1 ? zeta[1] - zeta[0] : 1;
  const cellArea = Math.abs(ds * dz);

  const forcesAt = (delta0: number): Float64Array => {
    const f = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const pen = delta0 - clearance[k];
      if (pen > 0) f[k] = pen / compliance[k];
    }
    return f;
  };

  // 二分 δ0
  let lo = 0;
  let hi = Math.max(1e-4, targetForce * compliance[0] * 2);
  // 确保上界足够
  for (let guard = 0; guard < 60; guard++) {
    const f = forcesAt(hi);
    if (f.reduce((a, b) => a + b, 0) >= targetForce) break;
    hi *= 2;
  }
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    const f = forcesAt(mid);
    const sum = f.reduce((a, b) => a + b, 0);
    if (sum > targetForce) hi = mid;
    else lo = mid;
  }
  const delta0 = (lo + hi) / 2;
  force.set(forcesAt(delta0));

  // 归一到目标载荷(线性模型等比缩放)
  const actualSum = force.reduce((a, b) => a + b, 0);
  if (actualSum > 0) {
    const scale = targetForce / actualSum;
    for (let k = 0; k < N; k++) force[k] *= scale;
  }

  let maxStress = 0;
  const cells: LoadedCell[] = [];
  const redZones: number[] = [];
  const intensity = new Float64Array(N);
  const edgeFlags = new Float64Array(N);

  for (let k = 0; k < N; k++) {
    deformation[k] = force[k] * compliance[k];
    const p = cellArea > 0 ? force[k] / cellArea : 0; // 名义面压 MPa (N/mm²)
    pressure[k] = p;
    // Hertz 接触应力: σH ≈ sqrt(Fn·E* / (π·L·Rρ)), 用格点等效力线宽
    const cg = { r1: derived.d1.r, r2: derived.d2.r };
    const rho = 1 / (1 / cg.r1 + 1 / cg.r2);
    const Eeff = load.elasticModulus / (2 * (1 - load.poissonRatio * load.poissonRatio));
    const lineWidth = Math.abs(dz);
    const stress = force[k] > 0 ? Math.sqrt((force[k] * Eeff) / (Math.PI * Math.max(lineWidth, 0.5) * rho)) : 0;
    maxStress = Math.max(maxStress, stress);

    const j = k % nZ;
    const isEdge = j <= 1 || j >= nZ - 2;
    const edgeConcentration = isEdge && stress > 0.7 * maxStress && maxStress > 0;
    if (edgeConcentration) {
      edgeFlags[k] = 1;
      redZones.push(k);
    }
    if (stress > load.allowableStress && !edgeConcentration) redZones.push(k);
    if (force[k] > 0) {
      cells.push({ index: k, force: force[k], pressure: p, stress, edgeConcentration });
      intensity[k] = Math.min(1, stress / Math.max(load.allowableStress, maxStress));
    }
  }

  // Kβ: 最大单位齿宽载荷 / 平均
  const rowLoad = new Float64Array(nZ);
  for (let j = 0; j < nZ; j++) {
    let sum = 0;
    for (let i = 0; i < nS; i++) sum += force[i * nZ + j];
    rowLoad[j] = sum;
  }
  const active = rowLoad.filter((x) => x > 0);
  const avg = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 1;
  const kBeta = avg > 0 ? Math.max(...active) / avg : 1;

  const pattern = summarizePattern(intensity, nS, nZ, s, zeta, 0);
  return {
    pressure,
    deformation,
    cells,
    totalForce: targetForce,
    maxStress,
    redZones,
    pattern,
    loadDistributionFactor: kBeta,
  };
}

export interface LoadedPair {
  light: LoadedResult;
  full: LoadedResult;
}

/** 一次出轻载(25%)与满载两套结果 */
export function runLoadedCases(
  derived: PairDerived,
  grid: TcaGrid,
  load: LoadCase,
): LoadedPair {
  const fullForce = totalNormalForce(derived, load.torqueNm);
  const lightLoad: LoadCase = { ...load, torqueNm: load.torqueNm * 0.25 };
  const lightForce = totalNormalForce(derived, lightLoad.torqueNm);
  return {
    light: solveLoaded(derived, grid, lightLoad, lightForce),
    full: solveLoaded(derived, grid, load, fullForce),
  };
}
