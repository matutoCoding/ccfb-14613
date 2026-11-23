/**
 * TCA 齿面接触分析引擎 (作用平面模型)
 *
 * 坐标系: 小轮轴线 z, 中心连线 x, 节点 P 处作用线单位法向 n0=(sin αt, cos αt, 0)
 * 接触点参数:
 *   s  —— 沿作用线相对节点的距离 (mm), 向小轮齿顶为正
 *   ζ  —— 小轮齿宽坐标 (mm), 相对齿宽中点
 *
 * 核心性质: 理想渐开线共轭 + 零修形 + 零误差时, 间隙场处处为常数(侧隙),
 * 接触区天然贯穿全齿宽; 传动误差恒为零。所有非理想因素以附加法向间隙叠加。
 */
import type { FlankSide, LoadCase } from './types';
import { rollAtRadius } from './geometry';
import type { PairDerived } from './pair';
import type { ModificationPlan, ModificationParams } from './modification';
import { modificationAt, sideParams } from './modification';
import type { EffectiveErrors } from './assembly';

export interface TcaGrid {
  nS: number;
  nZ: number;
  s: Float64Array;
  zeta: Float64Array;
  /** 间隙场 (mm), 行=s 列=ζ; 正值分离 */
  clearance: Float64Array;
  /** 法向柔度 (mm/N) */
  compliance: Float64Array;
}

export interface ContactPattern {
  /** 着色强度场 0..1, 同网格布局 */
  intensity: Float64Array;
  nS: number;
  nZ: number;
  s: Float64Array;
  zeta: Float64Array;
  contactCells: number;
  maxIntensity: number;
  centroidS: number;
  centroidZ: number;
  /** 齿宽方向接触长度占比 0..1 */
  lengthFraction: number;
  /** 齿高方向接触高度占比 0..1 */
  heightFraction: number;
  offsetZ: number;
  offsetS: number;
  /** 接触区长轴相对齿向的倾角 rad */
  tiltAngle: number;
  /** 红丹阈值 (mm) */
  thresholdMm: number;
}

export interface TePoint {
  theta1: number;
  te: number;
}

export interface TcaResult {
  grid: TcaGrid;
  pattern: ContactPattern;
  te: TePoint[];
  tePeakToPeak: number;
  teMeshAmplitude: number;
  minClearance: number;
}

interface ContactGeom {
  r1: number;
  r2: number;
  z1: number;
  z2: number;
  rho1: number;
  rho2: number;
  zetaBar1: number;
  zetaBar2: number;
}

export function contactGeom(derived: PairDerived, s: number, zeta: number): ContactGeom {
  const { d1, d2 } = derived;
  // 小轮: 作用线上滚动距离 q1 = rb1·u1 = rb1·uP + s
  const q1 = d1.rb * d1.uPitch + s;
  const r1 = Math.hypot(d1.rb, q1);
  // 大轮: 作用线总滚动距离守恒 q1 + q2 = rb1·uP1 + rb2·uP2
  const q2 = d1.rb * d1.uPitch + d2.rb * d2.uPitch - q1;
  const r2 = Math.hypot(d2.rb, q2);
  const z1 = zeta;
  // 螺旋齿接触线: z·tanβb/rb 在两轮上大小相等、符号相反(外啮合旋向相反)
  const z2 = -(zeta * Math.tan(d1.betaB) / d1.rb) * (d2.rb / Math.tan(d2.betaB || 1e-9));
  const depth1 = d1.ra - Math.max(d1.rb, d1.rf);
  const depth2 = d2.ra - Math.max(d2.rb, d2.rf);
  const rho1 = (d1.ra - r1) / depth1;
  const rho2 = (r2 - Math.max(d2.rb, d2.rf)) / depth2;
  return {
    r1,
    r2,
    z1,
    z2: d1.betaB === 0 ? 0 : z2,
    rho1: Math.min(1, Math.max(0, rho1)),
    rho2: Math.min(1, Math.max(0, rho2)),
    zetaBar1: zeta / (derived.pinionV.faceWidth / 2),
    zetaBar2: z2 / (derived.gearV.faceWidth / 2),
  };
}

function modSum(
  plan: ModificationPlan,
  side: FlankSide,
  derived: PairDerived,
  cg: ContactGeom,
): number {
  const depth1 = derived.d1.ra - Math.max(derived.d1.rb, derived.d1.rf);
  const depth2 = derived.d2.ra - Math.max(derived.d2.rb, derived.d2.rf);
  const m1: ModificationParams = sideParams(plan, 'pinion', side);
  const m2: ModificationParams = sideParams(plan, 'gear', side);
  return (
    modificationAt(m1, cg.zetaBar1, cg.rho1, derived.pinionV.faceWidth, depth1) +
    modificationAt(m2, cg.zetaBar2, cg.rho2, derived.gearV.faceWidth, depth2)
  );
}

/**
 * 装配误差的线性化法向间隙 (mm)
 * 误差向量 -> 接触点相对位移 -> 作用线法向投影: δ = -n0·(Δt + Δθ×r)
 */
export function errorGap(derived: PairDerived, eff: EffectiveErrors, s: number, zeta: number): number {
  const alphaT = derived.d1.alphaT;
  const st = Math.sin(alphaT);
  const ct = Math.cos(alphaT);
  const cg = contactGeom(derived, s, zeta);
  // Δa 沿中心连线 x: 法向投影 n0·x = sin αt
  const gCenter = eff.centerDistance * st;
  // 面内偏斜(小轮轴绕 y 转 θy): 接触点位移 Δθ×r 的 x 分量 ≈ -θy·z?
  // 绕 y: Δθ×r = (θy·z, 0, -θy·x); 法向投影 = θy·z·sinα - θy·x·cosα
  const xContact = cg.r1 * st + s * st;
  const gTiltIn = eff.tiltInPlane * (zeta * st - xContact * ct);
  // 交错偏斜(绕 x): Δθ×r = (0, -θx·z, θx·y); 法向投影 = -θx·z·cosα
  const gTiltCross = -eff.tiltCross * zeta * ct;
  return gCenter + gTiltIn + gTiltCross;
}

/** 有效作用线范围: 两轮齿顶圆与作用线交点 */
export function actionRange(derived: PairDerived): [number, number] {
  const { d1, d2 } = derived;
  const qP1 = d1.rb * d1.uPitch;
  const qP2 = d2.rb * d2.uPitch;
  const q1Tip = Math.sqrt(Math.max(0, d1.ra * d1.ra - d1.rb * d1.rb));
  const q2Tip = Math.sqrt(Math.max(0, d2.ra * d2.ra - d2.rb * d2.rb));
  // s = q1 - qP1; 大轮齿顶限制 q1 >= qP1+qP2-q2Tip
  const sMin = qP2 - q2Tip;
  const sMax = q1Tip - qP1;
  return [sMin, sMax];
}

/** 局部法向柔度 (mm/N): 轮齿悬臂弯曲 + Hertz 接触, 工程近似 */
export function localCompliance(derived: PairDerived, cg: ContactGeom, load: LoadCase): number {
  const Eeff = load.elasticModulus / (2 * (1 - load.poissonRatio * load.poissonRatio));
  const mn = derived.pinionV.module;
  const h = derived.d1.ra - derived.d1.rf;
  const bend = (h * h * h) / (Eeff * derived.pinionV.faceWidth * mn * mn * 8);
  const rho = 1 / (1 / Math.max(cg.r1, mn) + 1 / Math.max(cg.r2, mn));
  const hertz = 1 / (Eeff * Math.max(rho, mn) * 0.25);
  return bend + hertz;
}

export interface BuildOptions {
  nS?: number;
  nZ?: number;
  load?: LoadCase;
}

export function buildGrid(
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  eff: EffectiveErrors,
  opts: BuildOptions = {},
): TcaGrid {
  const nS = opts.nS ?? 48;
  const nZ = opts.nZ ?? 48;
  const load = opts.load ?? {
    torqueNm: 0,
    rpm: 0,
    elasticModulus: 2.06e5,
    poissonRatio: 0.3,
    allowableStress: 1200,
  };
  const [sLo, sHi] = actionRange(derived);
  const b1 = derived.pinionV.faceWidth;
  const s = new Float64Array(nS);
  const zeta = new Float64Array(nZ);
  const clearance = new Float64Array(nS * nZ);
  const compliance = new Float64Array(nS * nZ);
  for (let i = 0; i < nS; i++) s[i] = sLo + ((sHi - sLo) * i) / (nS - 1);
  for (let j = 0; j < nZ; j++) zeta[j] = -b1 / 2 + (b1 * j) / (nZ - 1);
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nZ; j++) {
      const cg = contactGeom(derived, s[i], zeta[j]);
      clearance[i * nZ + j] =
        modSum(plan, side, derived, cg) + errorGap(derived, eff, s[i], zeta[j]);
      compliance[i * nZ + j] = localCompliance(derived, cg, load);
    }
  }
  return { nS, nZ, s, zeta, clearance, compliance };
}

/**
 * 转一圈累计着色: 每个 (s,ζ) 格点在整圈啮合中取最小间隙,
 * 小于红丹层厚即着色, 强度随间隙线性变化(模拟红丹研磨转移)
 */
export function simulateRotation(grid: TcaGrid, redLeadUm: number): ContactPattern {
  const { nS, nZ, s, zeta, clearance } = grid;
  const threshold = redLeadUm * 1e-3;
  const intensity = new Float64Array(nS * nZ);
  let minGap = Infinity;
  for (let idx = 0; idx < clearance.length; idx++) {
    const g = clearance[idx];
    minGap = Math.min(minGap, g);
    if (g <= threshold) {
      intensity[idx] = Math.max(0, 1 - Math.max(0, g) / threshold);
    }
  }
  smooth3(intensity, nS, nZ);
  return summarizePattern(intensity, nS, nZ, s, zeta, threshold);
}

function smooth3(f: Float64Array, nS: number, nZ: number): void {
  const tmp = new Float64Array(f.length);
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nZ; j++) {
      let sum = 0;
      let cnt = 0;
      for (const di of [-1, 0, 1]) {
        for (const dj of [-1, 0, 1]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && ii < nS && jj >= 0 && jj < nZ) {
            sum += f[ii * nZ + jj];
            cnt++;
          }
        }
      }
      tmp[i * nZ + j] = sum / cnt;
    }
  }
  f.set(tmp);
}

export function summarizePattern(
  intensity: Float64Array,
  nS: number,
  nZ: number,
  s: Float64Array,
  zeta: Float64Array,
  thresholdMm: number,
): ContactPattern {
  let contactCells = 0;
  let maxIntensity = 0;
  let wSumS = 0;
  let wSumZ = 0;
  let wTotal = 0;
  let iMin = nS;
  let iMax = -1;
  let jMin = nZ;
  let jMax = -1;
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nZ; j++) {
      const w = intensity[i * nZ + j];
      if (w > 0.05) {
        contactCells++;
        iMin = Math.min(iMin, i);
        iMax = Math.max(iMax, i);
        jMin = Math.min(jMin, j);
        jMax = Math.max(jMax, j);
      }
      maxIntensity = Math.max(maxIntensity, w);
      wSumS += s[i] * w;
      wSumZ += zeta[j] * w;
      wTotal += w;
    }
  }
  const centroidS = wTotal > 0 ? wSumS / wTotal : 0;
  const centroidZ = wTotal > 0 ? wSumZ / wTotal : 0;
  const lengthFraction = jMax >= 0 ? (jMax - jMin + 1) / nZ : 0;
  const heightFraction = iMax >= 0 ? (iMax - iMin + 1) / nS : 0;
  let mZZ = 0;
  let mSS = 0;
  let mZS = 0;
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nZ; j++) {
      const w = intensity[i * nZ + j];
      mZZ += (zeta[j] - centroidZ) ** 2 * w;
      mSS += (s[i] - centroidS) ** 2 * w;
      mZS += (zeta[j] - centroidZ) * (s[i] - centroidS) * w;
    }
  }
  const tiltAngle = 0.5 * Math.atan2(2 * mZS, mZZ - mSS);
  return {
    intensity,
    nS,
    nZ,
    s,
    zeta,
    contactCells,
    maxIntensity,
    centroidS,
    centroidZ,
    lengthFraction,
    heightFraction,
    offsetZ: centroidZ,
    offsetS: centroidS,
    tiltAngle,
    thresholdMm,
  };
}

/**
 * 传动误差 (折算到小轮, rad)
 * 任一转角下, 系统沿作用线的最小法向间隙即所需的刚体趋近量;
 * TE = 最小间隙 / rb1。理想工况间隙场为常数 -> TE 恒为 0。
 * 沿作用线以 basePitch 为周期采样若干啮合位置。
 */
export function transmissionError(
  derived: PairDerived,
  grid: TcaGrid,
  steps = 120,
): { points: TePoint[]; pp: number; meshAmp: number } {
  const { nS, nZ, s, clearance } = grid;
  const rb1 = derived.d1.rb;
  const basePitch = (2 * Math.PI * rb1) / derived.pinionV.teeth;
  const span = s[nS - 1] - s[0];
  const points: TePoint[] = [];
  const raw: number[] = [];
  for (let k = 0; k < steps; k++) {
    const shift = (k / steps) * basePitch;
    let minG = Infinity;
    for (let i = 0; i < nS; i++) {
      const target = s[i] - shift;
      if (target < s[0] || target > s[nS - 1]) continue;
      const iSrc = nearestIndex(s, target);
      for (let j = 0; j < nZ; j++) {
        const g = clearance[iSrc * nZ + j];
        if (g < minG) minG = g;
      }
    }
    if (!Number.isFinite(minG)) minG = 0;
    const te = minG / rb1;
    raw.push(te);
    points.push({ theta1: (k / steps) * 2 * Math.PI, te: 0 });
  }
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  for (let k = 0; k < steps; k++) points[k].te = raw[k] - mean;
  let teMin = Infinity;
  let teMax = -Infinity;
  for (const x of raw) {
    teMin = Math.min(teMin, x - mean);
    teMax = Math.max(teMax, x - mean);
  }
  const meshAmp = dftAmplitude(points.map((p) => p.te), 1);
  void span;
  return { points, pp: teMax - teMin, meshAmp };
}

function nearestIndex(arr: Float64Array, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function dftAmplitude(signal: number[], harmonic: number): number {
  const N = signal.length;
  let re = 0;
  let im = 0;
  for (let k = 0; k < N; k++) {
    const ang = (2 * Math.PI * harmonic * k) / N;
    re += signal[k] * Math.cos(ang);
    im -= signal[k] * Math.sin(ang);
  }
  return Math.hypot(re, im) / (N / 2);
}

export interface TcaOptions {
  nS?: number;
  nZ?: number;
  steps?: number;
  redLeadUm?: number;
  load?: LoadCase;
}

/** 间隙场降采样向量(供反推/照片对齐使用), 行优先 (s,ζ) */
export function clearanceVector(
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  eff: EffectiveErrors,
  nS = 9,
  nZ = 9,
): { s: Float64Array; zeta: Float64Array; g: Float64Array } {
  const grid = buildGrid(derived, plan, side, eff, { nS, nZ });
  return { s: grid.s, zeta: grid.zeta, g: grid.clearance };
}

export function runTca(
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  eff: EffectiveErrors,
  opts: TcaOptions = {},
): TcaResult {
  const grid = buildGrid(derived, plan, side, eff, {
    nS: opts.nS,
    nZ: opts.nZ,
    load: opts.load,
  });
  const pattern = simulateRotation(grid, opts.redLeadUm ?? plan.redLeadThickness);
  const teRes = transmissionError(derived, grid, opts.steps ?? 120);
  let minClearance = Infinity;
  for (const x of grid.clearance) minClearance = Math.min(minClearance, x);
  return {
    grid,
    pattern,
    te: teRes.points,
    tePeakToPeak: teRes.pp,
    teMeshAmplitude: teRes.meshAmp,
    minClearance,
  };
}

export { rollAtRadius };
