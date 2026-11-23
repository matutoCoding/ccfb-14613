/**
 * 装配误差反推
 *
 * 两条通道:
 *  1) 间隙场拟合(主): 由仿真/照片对齐后的间隙网格直接最小二乘,
 *     误差->间隙在本系统中是线性模型, 一次迭代即可精确恢复全部自由度
 *  2) 斑点特征拟合(辅): 仅能拿到照片(无间隙场)时, 用质心/倾角/尺寸特征迭代
 */
import type { AssemblyError, GearPair, FlankSide } from './types';
import type { PairDerived } from './pair';
import type { ModificationPlan } from './modification';
import { effectiveErrors, type EffectiveErrors } from './assembly';
import { buildGrid, simulateRotation, clearanceVector, type ContactPattern } from './tca';

export type ErrorKey =
  | 'centerDistanceError'
  | 'parallelismInPlane'
  | 'parallelismCross'
  | 'pinionMountingError'
  | 'gearMountingError'
  | 'shaftAngleError';

export const ERROR_KEYS: ErrorKey[] = [
  'centerDistanceError',
  'parallelismInPlane',
  'parallelismCross',
  'pinionMountingError',
  'gearMountingError',
  'shaftAngleError',
];

/** 各自由度的特征缩放尺度 (mm 或 rad) */
export const ERROR_SCALE: Record<ErrorKey, number> = {
  centerDistanceError: 0.05,
  parallelismInPlane: 0.0005,
  parallelismCross: 0.0005,
  pinionMountingError: 0.1,
  gearMountingError: 0.1,
  shaftAngleError: 0.0005,
};

export interface InverseResult {
  errors: Record<ErrorKey, number>;
  /** 最终间隙场 RMS 残差 (mm) */
  residual: number;
  iterations: number;
  predicted: PatternFeatures;
  conditionNumber: number;
}

export interface PatternFeatures {
  offsetZ: number;
  offsetS: number;
  tiltAngle: number;
  lengthFraction: number;
  heightFraction: number;
  maxIntensity: number;
}

export function patternFeatures(p: ContactPattern): PatternFeatures {
  return {
    offsetZ: p.centroidZ,
    offsetS: p.centroidS,
    tiltAngle: p.tiltAngle,
    lengthFraction: p.lengthFraction,
    heightFraction: p.heightFraction,
    maxIntensity: p.maxIntensity,
  };
}

function blankAssembly(pairId: string): AssemblyError {
  return {
    id: 'inv',
    name: '反推',
    updatedAt: 0,
    pairId,
    centerDistanceError: 0,
    parallelismInPlane: 0,
    parallelismCross: 0,
    pinionMountingError: 0,
    gearMountingError: 0,
    shaftAngleError: 0,
    housingTorque: 0,
    housingStiffness: Infinity,
  };
}

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-20) throw new Error('奇异矩阵');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col + 1; c <= n; c++) M[r][c] -= f * M[col][c];
      M[r][col] = 0;
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 条件数近似: 雅可比列范数最大/最小比 */
function conditionOf(J: number[][]): number {
  const n = J[0].length;
  const norms: number[] = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < J.length; i++) s += J[i][j] * J[i][j];
    norms.push(Math.sqrt(s));
  }
  const active = norms.filter((x) => x > 1e-18);
  if (active.length < n) return Infinity;
  return Math.max(...norms) / Math.min(...norms);
}

/**
 * 间隙场反推(主通道)
 * @param targetGap 目标间隙场 (mm), 通常来自 forward 仿真或照片对齐后的估计
 * @param activeKeys 启用自由度
 */
export function inverseFromGapField(
  pair: GearPair,
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  targetGap: Float64Array,
  activeKeys?: ErrorKey[],
): InverseResult {
  const keys =
    activeKeys ??
    (derived.isBevel
      ? (['pinionMountingError', 'gearMountingError', 'shaftAngleError'] as ErrorKey[])
      : (['centerDistanceError', 'parallelismInPlane', 'parallelismCross'] as ErrorKey[]));
  const nS = 9;
  const nZ = 9;
  const blank = blankAssembly(pair.id);
  const g0 = clearanceVector(derived, plan, side, effectiveErrors(pair, derived, blank), nS, nZ);
  const m = g0.g.length;
  const n = keys.length;

  // 雅可比: 单位物理扰动(1mm / 1rad)下的间隙变化, 法方程的解直接等于物理误差量
  const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  keys.forEach((k, j) => {
    const asm = blankAssembly(pair.id);
    (asm[k] as number) = 1;
    const gj = clearanceVector(derived, plan, side, effectiveErrors(pair, derived, asm), nS, nZ);
    for (let i = 0; i < m; i++) J[i][j] = gj.g[i] - g0.g[i];
  });

  // 残差 r = target - g0, 解 J·x = r, x 为无量纲变量(实际误差 = x·scale)
  const r = new Array(m).fill(0).map((_, i) => targetGap[i] - g0.g[i]);
  const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const Jtr: number[] = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
      JtJ[a][b] = s;
    }
    let s = 0;
    for (let i = 0; i < m; i++) s += J[i][a] * r[i];
    Jtr[a] = s;
  }
  // 相对岭回归: 阻尼取对角均值的 1e-10, 另加固定地板防全零
  const trace = JtJ.reduce((acc, row, i) => acc + row[i], 0) / n;
  for (let i = 0; i < n; i++) JtJ[i][i] += trace * 1e-10 + 1e-12;
  const x = gaussSolve(JtJ, Jtr);

  const errors = {} as Record<ErrorKey, number>;
  for (const k of ERROR_KEYS) errors[k] = 0;
  keys.forEach((k, j) => {
    errors[k] = x[j];
  });

  // 残差与预测特征
  const checkAsm = blankAssembly(pair.id);
  keys.forEach((k, j) => {
    (checkAsm[k] as number) = x[j];
  });
  const eff = effectiveErrors(pair, derived, checkAsm);
  const grid = buildGrid(derived, plan, side, eff, { nS: 40, nZ: 40 });
  const pat = simulateRotation(grid, plan.redLeadThickness);
  let ss = 0;
  const gCheck = clearanceVector(derived, plan, side, eff, nS, nZ);
  for (let i = 0; i < m; i++) ss += (gCheck.g[i] - targetGap[i]) ** 2;

  return {
    errors,
    residual: Math.sqrt(ss / m),
    iterations: 1,
    predicted: patternFeatures(pat),
    conditionNumber: conditionOf(J),
  };
}

/**
 * 斑点特征反推(照片通道): 高斯-牛顿, 对无量纲变量迭代
 */
export function inverseFromFeatures(
  pair: GearPair,
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  target: PatternFeatures,
  activeKeys?: ErrorKey[],
  maxIter = 8,
): InverseResult {
  const keys =
    activeKeys ??
    (derived.isBevel
      ? (['pinionMountingError', 'gearMountingError', 'shaftAngleError'] as ErrorKey[])
      : (['centerDistanceError', 'parallelismInPlane', 'parallelismCross'] as ErrorKey[]));
  const x = new Array(keys.length).fill(0);
  const scales = keys.map((k) => ERROR_SCALE[k]);

  const asmFromX = (xv: number[]): AssemblyError => {
    const asm = blankAssembly(pair.id);
    keys.forEach((k, i) => {
      (asm[k] as number) = xv[i] * scales[i];
    });
    return asm;
  };
  const feats = (asm: AssemblyError): PatternFeatures => {
    const grid = buildGrid(derived, plan, side, effectiveErrors(pair, derived, asm), {
      nS: 40,
      nZ: 40,
    });
    return patternFeatures(simulateRotation(grid, plan.redLeadThickness));
  };
  const fv = (f: PatternFeatures): number[] => [
    f.offsetZ,
    f.offsetS,
    f.tiltAngle,
    f.lengthFraction,
    f.heightFraction,
    f.maxIntensity,
  ];
  const targetVec = fv(target);
  const fScale = [
    Math.max(derived.pinionV.faceWidth * 0.1, 1e-3),
    Math.max(derived.pinionV.module, 1e-3),
    0.05,
    1,
    1,
    1,
  ];

  let residual = Infinity;
  let iter = 0;
  for (iter = 0; iter < maxIter; iter++) {
    const asm = asmFromX(x);
    const f0 = fv(feats(asm));
    const r = targetVec.map((tv, i) => (tv - f0[i]) / fScale[i]);
    residual = Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length);
    if (residual < 1e-5) break;

    const m = r.length;
    const n = keys.length;
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] += 1e-3;
      const fp = fv(feats(asmFromX(xp)));
      for (let i = 0; i < m; i++) J[i][j] = (fp[i] - f0[i]) / (fScale[i] * 1e-3);
    }
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr: number[] = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += J[k][a] * J[k][b];
        JtJ[a][b] = s;
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][a] * r[k];
      Jtr[a] = s;
    }
    const trace = JtJ.reduce((acc, row, i) => acc + row[i], 0) / n;
    for (let i = 0; i < n; i++) JtJ[i][i] += trace * 1e-10 + 1e-12;
    let dx: number[];
    try {
      dx = gaussSolve(JtJ, Jtr);
    } catch {
      break;
    }
    for (let j = 0; j < n; j++) x[j] += dx[j];
  }

  const finalAsm = asmFromX(x);
  const errors = {} as Record<ErrorKey, number>;
  for (const k of ERROR_KEYS) errors[k] = 0;
  keys.forEach((k, i) => {
    errors[k] = x[i] * scales[i];
  });
  const predicted = feats(finalAsm);
  // 条件数: 间隙场雅可比列范数比
  const condJ: number[][] = Array.from({ length: 81 }, () => new Array(keys.length).fill(0));
  keys.forEach((k, j) => {
    const asm = blankAssembly(pair.id);
    (asm[k] as number) = ERROR_SCALE[k];
    const gj = clearanceVector(derived, plan, side, effectiveErrors(pair, derived, asm), 9, 9);
    const g0c = clearanceVector(derived, plan, side, effectiveErrors(pair, derived, blankAssembly(pair.id)), 9, 9);
    for (let i = 0; i < 81; i++) condJ[i][j] = gj.g[i] - g0c.g[i];
  });
  return {
    errors,
    residual,
    iterations: iter + 1,
    predicted,
    conditionNumber: conditionOf(condJ),
  };
}

/** 兼容旧调用名: 默认走间隙场主通道(测试使用) */
export function inverseErrors(
  pair: GearPair,
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  target: PatternFeatures,
  activeKeys?: ErrorKey[],
): InverseResult {
  // 用目标特征重建等效间隙场: 以该特征再跑一次正向不现实,
  // 这里由调用方改用 inverseFromGapField; 保留签名时转特征通道
  return inverseFromFeatures(pair, derived, plan, side, target, activeKeys);
}

export function effToAssembly(eff: EffectiveErrors, pairId: string): AssemblyError {
  return {
    ...blankAssembly(pairId),
    id: 'eff',
    name: '等效误差',
    centerDistanceError: eff.centerDistance,
    parallelismInPlane: eff.tiltInPlane,
    parallelismCross: eff.tiltCross,
  };
}
