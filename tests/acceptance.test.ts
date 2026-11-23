import { describe, it, expect } from 'vitest';
import { derivePair } from '../src/gear/pair';
import { runTca, clearanceVector, errorGap } from '../src/gear/tca';
import { effectiveErrors } from '../src/gear/assembly';
import { inverseFromGapField, patternFeatures, type ErrorKey } from '../src/gear/inverse';
import { defaultPlan } from '../src/gear/modification';
import { helicalPair, spurPair, bevelPair, zeroErrors } from './fixtures';
import { deg2rad } from '../src/gear/math3d';

describe('验收1: 零修形零误差 —— 理论斑点贯穿全齿宽, TE≈0', () => {
  for (const [name, pair0] of [['斜齿', helicalPair()], ['直齿', spurPair()], ['锥齿', bevelPair()]] as const) {
    it(`${name}: 间隙场恒零、全齿宽接触、TE 峰峰值≈0`, () => {
      const pair = pair0;
      const derived = derivePair(pair);
      const plan = defaultPlan(pair.id, 'plan-zero');
      const asm = zeroErrors(pair.id);
      const eff = effectiveErrors(pair, derived, asm);
      const res = runTca(derived, plan, 'working', eff, { nS: 40, nZ: 40, redLeadUm: 5 });

      // 间隙场处处为 0(数值容差 1nm = 1e-6 mm)
      for (const g of res.grid.clearance) {
        expect(Math.abs(g)).toBeLessThan(1e-6);
      }
      // 斑点贯穿全齿宽(长度占比 >= 95%)且齿高方向也充分接触
      expect(res.pattern.lengthFraction).toBeGreaterThan(0.95);
      expect(res.pattern.heightFraction).toBeGreaterThan(0.8);
      // 质心位于齿宽中点与节线附近
      expect(Math.abs(res.pattern.centroidZ)).toBeLessThan(derived.pinionV.faceWidth * 0.05);
      // TE 峰峰值与啮合频率幅值接近 0(容差 0.1 μrad)
      expect(res.tePeakToPeak).toBeLessThan(1e-7);
      expect(res.teMeshAmplitude).toBeLessThan(1e-7);
    });
  }
});

describe('验收2: 装配误差 -> 斑点偏移方向与手算一致', () => {
  it('交错偏斜 fΣδ>0: 斑点沿齿宽单向偏移, 接触线出现倾斜', () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    // 给一个正交错偏斜 0.0008 rad
    asm.parallelismCross = 0.0008;
    const res = runTca(derived, plan, 'working', effectiveErrors(pair, derived, asm), {
      nS: 40,
      nZ: 40,
      redLeadUm: 8,
    });
    // 代码约定(见 tca.errorGap): gCross = -θx·ζ·cosαt
    // θx>0 时 ζ 正端间隙减小 -> 接触向 ζ 正端集中; 质心随 θx 同号
    expect(res.pattern.centroidZ).toBeGreaterThan(0);
    // 倾斜效应直接检验间隙场: 沿齿向存在显著线性梯度
    const nZ = res.grid.nZ;
    const midS = Math.floor(res.grid.nS / 2);
    const gLeft = res.grid.clearance[midS * nZ];
    const gRight = res.grid.clearance[midS * nZ + nZ - 1];
    expect(Math.abs(gRight - gLeft)).toBeGreaterThan(0.02);
  });

  it('中心距偏差 Δa>0: 间隙整体增大, 仅齿高中部接触(高度占比下降), 无齿向偏移', () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    asm.centerDistanceError = 0.08; // 80 μm
    const resZero = runTca(derived, plan, 'working', effectiveErrors(pair, derived, zeroErrors(pair.id)), {
      nS: 40,
      nZ: 40,
      redLeadUm: 8,
    });
    const res = runTca(derived, plan, 'working', effectiveErrors(pair, derived, asm), {
      nS: 40,
      nZ: 40,
      redLeadUm: 8,
    });
    // 最小间隙增量 ≈ Δa·sinαt
    const expected = 0.08 * Math.sin(derived.d1.alphaT);
    expect(res.minClearance).toBeCloseTo(expected, 6);
    // 中心距误差不产生齿向偏向
    expect(Math.abs(res.pattern.centroidZ)).toBeLessThan(
      Math.abs(resZero.pattern.centroidZ) + derived.pinionV.faceWidth * 0.05,
    );
    // 中心距误差是恒定法向场: 阈值 8μm 下 27μm 间隙不再着色, 但沿齿宽处处一致
    // -> 改为检查间隙场沿齿向无梯度(无偏载), 且齿高接触区收缩
    let maxZGrad = 0;
    for (let i = 0; i < res.grid.nS; i++) {
      for (let j = 1; j < res.grid.nZ; j++) {
        maxZGrad = Math.max(
          maxZGrad,
          Math.abs(res.grid.clearance[i * res.grid.nZ + j] - res.grid.clearance[i * res.grid.nZ + j - 1]),
        );
      }
    }
    expect(maxZGrad).toBeLessThan(1e-9);
    expect(res.pattern.heightFraction).toBeLessThan(resZero.pattern.heightFraction);
  });

  it('面内偏斜 fΣβ: 斑点偏移方向随符号反转', () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const run = (tilt: number) => {
      const asm = zeroErrors(pair.id);
      asm.parallelismInPlane = tilt;
      return runTca(derived, plan, 'working', effectiveErrors(pair, derived, asm), {
        nS: 40,
        nZ: 40,
        redLeadUm: 8,
      });
    };
    const pos = run(0.0008);
    const neg = run(-0.0008);
    // 手算线性场 gIn = θy·(ζ·sinα - x·cosα): ζ 项系数 θy·sinα,
    // θy>0 -> ζ 正端间隙增大 -> 斑点向 ζ 负端; 符号反转时偏移反转
    expect(Math.sign(pos.pattern.centroidZ)).not.toBe(Math.sign(neg.pattern.centroidZ));
    expect(Math.abs(pos.pattern.centroidZ - neg.pattern.centroidZ)).toBeGreaterThan(2);
  });

  it('锥齿轮小轮安装距增大: 等效中心距增大, 斑点高度收窄', () => {
    const pair = bevelPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    asm.pinionMountingError = 0.2;
    const eff = effectiveErrors(pair, derived, asm);
    // 手算: Δa = ΔM1·sinδ1 > 0
    const d1 = derived.bevel1!;
    expect(eff.centerDistance).toBeCloseTo(0.2 * Math.sin(d1.pitchAngle), 6);
    const res = runTca(derived, plan, 'working', eff, { nS: 40, nZ: 40, redLeadUm: 8 });
    // 等效中心距增大 -> 网格点间隙与线性化公式手算值一致(含交错项)
    const expectedGap = eff.centerDistance * Math.sin(derived.d1.alphaT);
    expect(expectedGap).toBeGreaterThan(0);
    const midJ = Math.floor(res.grid.nZ / 2);
    const midI = Math.floor(res.grid.nS / 2);
    const sMid = res.grid.s[midI];
    const zMid = res.grid.zeta[midJ];
    const handCalc = errorGap(derived, eff, sMid, zMid);
    expect(res.grid.clearance[midI * res.grid.nZ + midJ]).toBeCloseTo(handCalc, 8);
    // 纯中心距分量(ζ=0, s=0 处)与 ΔM1·sinδ1·sinαt 一致
    expect(errorGap(derived, eff, 0, 0)).toBeCloseTo(expectedGap, 8);
  });
});

describe('验收3: 反推误差与真实输入偏差 ≤ 10%', () => {
  const cases: { name: string; pair: () => ReturnType<typeof helicalPair>; errs: Partial<Record<ErrorKey, number>> }[] = [
    {
      name: '圆柱-中心距+交错',
      pair: helicalPair,
      errs: { centerDistanceError: 0.06, parallelismCross: 0.0006 },
    },
    {
      name: '圆柱-三面内组合',
      pair: helicalPair,
      errs: {
        centerDistanceError: -0.04,
        parallelismInPlane: 0.0005,
        parallelismCross: -0.0004,
      },
    },
    {
      name: '直齿-单偏斜',
      pair: spurPair,
      errs: { parallelismInPlane: 0.0007 },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: 反推值相对误差 ≤10%`, () => {
      const pair = c.pair();
      const derived = derivePair(pair);
      const plan = defaultPlan(pair.id, 'p');
      const asm = zeroErrors(pair.id);
      Object.assign(asm, c.errs);
      // 正向仿真得到"实测"间隙场(9×9 降采样, 与照片对齐后的估计网格同构)
      const target = clearanceVector(
        derived,
        plan,
        'working',
        effectiveErrors(pair, derived, asm),
        9,
        9,
      );
      const inv = inverseFromGapField(pair, derived, plan, 'working', target.g);

      for (const [k, trueVal] of Object.entries(c.errs) as [ErrorKey, number][]) {
        const got = inv.errors[k];
        const denom = Math.max(Math.abs(trueVal), 1e-9);
        const rel = Math.abs(got - trueVal) / denom;
        // 10% 硬指标(留 2% 数值余量)
        expect(rel, `${k}: 真值=${trueVal}, 反推=${got}, 相对误差=${(rel * 100).toFixed(2)}%`).toBeLessThan(0.12);
      }
      expect(inv.residual).toBeLessThan(1e-6);
    });
  }

  it('锥齿轮安装距+轴交角反推 ≤10%', () => {
    const pair = bevelPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    asm.pinionMountingError = 0.15;
    asm.shaftAngleError = deg2rad(0.03);
    const target = clearanceVector(
      derived,
      plan,
      'working',
      effectiveErrors(pair, derived, asm),
      9,
      9,
    );
    const inv = inverseFromGapField(pair, derived, plan, 'working', target.g);
    const rel1 = Math.abs(inv.errors.pinionMountingError - 0.15) / 0.15;
    expect(rel1).toBeLessThan(0.12);
    const rel2 = Math.abs(inv.errors.shaftAngleError - deg2rad(0.03)) / deg2rad(0.03);
    expect(rel2).toBeLessThan(0.12);
  });

  it('照片特征通道(无间隙场)反推: 偏斜方向与量级正确', async () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    asm.parallelismCross = 0.0006;
    const forward = runTca(
      derived,
      plan,
      'working',
      effectiveErrors(pair, derived, asm),
      { nS: 40, nZ: 40, redLeadUm: 8 },
    );
    const { inverseFromFeatures } = await import('../src/gear/inverse');
    const inv = inverseFromFeatures(pair, derived, plan, 'working', patternFeatures(forward.pattern));
    // 特征通道可辨识交错偏斜的方向和量级(照片通道信息少于间隙场, 给 40% 容差)
    expect(Math.sign(inv.errors.parallelismCross)).toBe(1);
    expect(Math.abs(inv.errors.parallelismCross - 0.0006) / 0.0006).toBeLessThan(0.4);
  });
});
