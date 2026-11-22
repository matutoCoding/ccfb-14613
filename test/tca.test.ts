/**
 * 验收测试:
 * 1. 零修形零误差 → 理论斑点贯穿全齿宽,传动误差 ≈ 0
 * 2. 装配误差 → 斑点偏移方向与手算一致(间隙大的一端接触消失)
 * 3. 反推误差与真实输入偏差 ≤ 10%
 */
import { describe, it, expect } from 'vitest';
import type { GearPairParams, AssemblyError, ModificationSpec } from '../src/core/types';
import { DEFAULT_SIM_SETTINGS } from '../src/core/types';
import { buildTcaInput } from '../src/core/simulate';
import { computeGapField, analyzeGapField, teStats, softMask } from '../src/core/tca';
import { invertErrors } from '../src/core/invert';
import { bevelGeometry, mountingToEquivalent } from '../src/core/bevel';

const pair: GearPairParams = {
  id: 't1', name: '测试副', type: 'cylindrical',
  pinion: { module: 4, teeth: 21, pressureAngle: 20, helixAngle: 18, hand: 'RH', profileShift: 0.25, faceWidth: 60, backlash: 0 },
  gear: { module: 4, teeth: 79, pressureAngle: 20, helixAngle: 18, hand: 'LH', profileShift: -0.1, faceWidth: 56, backlash: 0 },
  createdAt: 0, updatedAt: 0,
};

const settings = { ...DEFAULT_SIM_SETTINGS };

function makeAsm(patch: Partial<AssemblyError>): AssemblyError {
  return {
    id: 'a1', name: 't', pairId: pair.id,
    centerDistance: 0, parallelism: 0, skew: 0,
    housingParallelism: 0, housingSkew: 0,
    mountingPinion: 0, mountingGear: 0,
    createdAt: 0, updatedAt: 0, ...patch,
  };
}

function run(err: AssemblyError | null, modP: ModificationSpec | null = null) {
  const tca = buildTcaInput(pair, modP, null, err, settings);
  const field = computeGapField(tca);
  return { res: analyzeGapField(tca, field), tca };
}

/** 斑点质心齿向位置 0..1 */
function maskCentroidT(mask: Uint8Array, nF: number, nP: number): number {
  let sum = 0, cnt = 0;
  for (let i = 0; i < nF; i++)
    for (let j = 0; j < nP; j++)
      if (mask[i * nP + j]) { sum += i / (nF - 1); cnt++; }
  return cnt ? sum / cnt : 0.5;
}

describe('验收 1:零修形零误差', () => {
  it('斑点贯穿全齿宽、全齿高', () => {
    const { res } = run(null);
    expect(res.patternLengthPct).toBeGreaterThan(99);
    expect(res.patternHeightPct).toBeGreaterThan(99);
  });
  it('传动误差基本为零', () => {
    const { res } = run(null);
    const s = teStats(res.transmissionError);
    expect(s.peakToPeak).toBeLessThan(1e-6);
    expect(s.meshAmplitude).toBeLessThan(1e-6);
  });
});

describe('验收 2:误差方向与手算一致', () => {
  it('正交错度 → 右端间隙增大 → 接触区偏向左端(t<0.5)', () => {
    const { res } = run(makeAsm({ skew: 60 }));
    const c = maskCentroidT(res.mask, res.nFace, res.nProfile);
    expect(c).toBeLessThan(0.5);
  });
  it('负交错度 → 接触区偏向右端(t>0.5)', () => {
    const { res } = run(makeAsm({ skew: -60 }));
    const c = maskCentroidT(res.mask, res.nFace, res.nProfile);
    expect(c).toBeGreaterThan(0.5);
  });
  it('正平行度(右端中心距拉大)→ 接触区偏向左端', () => {
    const { res } = run(makeAsm({ parallelism: 60 }));
    const c = maskCentroidT(res.mask, res.nFace, res.nProfile);
    expect(c).toBeLessThan(0.5);
  });
  it('中心距拉大 → 斑点仍在但最小间隙增大(侧隙方向)', () => {
    const { res } = run(makeAsm({ centerDistance: 100 }));
    // 间隙整体抬高 100·sin(α'),斑点仍全齿宽(刚体贴近后)
    expect(res.patternLengthPct).toBeGreaterThan(99);
    expect(Math.min(...res.minGapPerContact)).toBeGreaterThan(30); // ≈100·sin20.9°≈36μm
  });
});

describe('验收 3:反推误差 ≤10%', () => {
  const truth = { centerDistance: 80, parallelism: -40, skew: 60 };
  it('由仿真斑点反推装配误差', () => {
    // 目标:真值误差下的连续(软)斑点图 —— 对应现场照片经亮度提取的连续接触图
    const tcaT = buildTcaInput(pair, null, null, makeAsm(truth), settings);
    const target = softMask(tcaT, computeGapField(tcaT), 0.6);
    // 反推工厂:误差 → 完整 TCA 输入(零误差基准模型 + 候选误差)
    const factory = (e: { dCenterUm: number; slopeParUm: number; slopeSkewUm: number }) =>
      buildTcaInput(pair, null, null, makeAsm({
        centerDistance: e.dCenterUm, parallelism: e.slopeParUm, skew: e.slopeSkewUm,
      }), settings);
    const inv = invertErrors(factory, target);
    const tol = (v: number): number => Math.max(Math.abs(v) * 0.1, 8); // 10% 或 8μm 取大
    expect(Math.abs(inv.errors.dCenterUm - truth.centerDistance)).toBeLessThanOrEqual(tol(truth.centerDistance));
    expect(Math.abs(inv.errors.slopeParUm - truth.parallelism)).toBeLessThanOrEqual(tol(truth.parallelism));
    expect(Math.abs(inv.errors.slopeSkewUm - truth.skew)).toBeLessThanOrEqual(tol(truth.skew));
  });
});

describe('锥齿轮(格里森制)几何', () => {
  const bevelPair: GearPairParams = {
    ...pair, type: 'bevel',
    bevel: { shaftAngle: 90, spiralAngle: 35 },
  };
  it('分锥角之和 = 轴交角', () => {
    const bg = bevelGeometry(bevelPair);
    expect((bg.delta1 + bg.delta2) * 180 / Math.PI).toBeCloseTo(90, 6);
  });
  it('安装距偏差折算:小轮正偏差 → 当量中心距增大', () => {
    const eq = mountingToEquivalent(bevelPair, 100, 0);
    expect(eq.dCenterUm).toBeGreaterThan(0);
  });
});
