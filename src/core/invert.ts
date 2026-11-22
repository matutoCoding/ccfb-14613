/**
 * 装配误差反推:给定实测斑点掩膜,搜索最可能的误差组合。
 * 目标函数:软掩膜(sigmoid 接触判据)与实测掩膜的均方差 —— 连续可微,
 * 使中心距偏差(通过接触窗口在齿高方向的移动)也可辨识。
 * 策略:粗网格搜索 + Nelder-Mead 局部精化。
 */
import type { TcaInput, TcaErrors } from './tca';
import { computeGapField, softMask } from './tca';

export interface InvertResult {
  errors: TcaErrors;
  residual: number; // 软掩膜均方根偏差 0..1
  iterations: number;
}

/** 由误差构造完整 TCA 输入(中心距偏差会移动接触窗口,必须重建) */
export type TcaFactory = (errors: TcaErrors) => TcaInput;

const SOFT_K1 = 1.5;  // 第一阶段软掩膜过渡宽度 μm
const SOFT_K2 = 0.6;  // 精化阶段(与目标图一致的锐度)

/** 反推目标图:连续值 [0,1](硬掩膜会自动转成 0/1 浮点) */
export type TargetMap = Float32Array | Uint8Array;

function softObjective(build: TcaFactory, errors: TcaErrors, target: TargetMap, softK: number): number {
  const inp = build(errors);
  const field = computeGapField(inp);
  const soft = softMask(inp, field, softK);
  let obj = 0;
  for (let i = 0; i < target.length; i++) {
    const d = soft[i] - target[i];
    obj += d * d;
  }
  return Math.sqrt(obj / target.length);
}

/** Nelder-Mead 单纯形(3 维) */
function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  step: number[],
  maxIter: number,
): { x: number[]; fx: number; iter: number } {
  const n = x0.length;
  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += step[i];
    simplex.push(p);
  }
  let fx = simplex.map(f);
  let iter = 0;
  const centroid = (pts: number[][], exclude: number): number[] => {
    const c = new Array(n).fill(0);
    pts.forEach((p, idx) => { if (idx !== exclude) for (let d = 0; d < n; d++) c[d] += p[d] / n; });
    return c;
  };
  while (iter++ < maxIter) {
    const order = simplex.map((_, i) => i).sort((a, b) => fx[a] - fx[b]);
    simplex = order.map((i) => simplex[i]);
    fx = order.map((i) => fx[i]);
    if (Math.abs(fx[n] - fx[0]) < 1e-12) break;
    const c = centroid(simplex, n);
    const worst = simplex[n];
    const refl = c.map((v, d) => v + (v - worst[d]));
    const fRefl = f(refl);
    if (fRefl < fx[0]) {
      const exp = c.map((v, d) => v + 2 * (v - worst[d]));
      const fExp = f(exp);
      if (fExp < fRefl) { simplex[n] = exp; fx[n] = fExp; } else { simplex[n] = refl; fx[n] = fRefl; }
    } else if (fRefl < fx[n - 1]) {
      simplex[n] = refl; fx[n] = fRefl;
    } else {
      const con = c.map((v, d) => v + 0.5 * (worst[d] - v));
      const fCon = f(con);
      if (fCon < fx[n]) { simplex[n] = con; fx[n] = fCon; }
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, d) => simplex[0][d] + 0.5 * (v - simplex[0][d]));
          fx[i] = f(simplex[i]);
        }
      }
    }
  }
  const best = fx.indexOf(Math.min(...fx));
  return { x: simplex[best], fx: fx[best], iter };
}

export function invertErrors(build: TcaFactory, targetMask: TargetMap): InvertResult {
  const f1 = (x: number[]): number =>
    softObjective(build, { dCenterUm: x[0], slopeParUm: x[1], slopeSkewUm: x[2] }, targetMask, SOFT_K1);
  const f2 = (x: number[]): number =>
    softObjective(build, { dCenterUm: x[0], slopeParUm: x[1], slopeSkewUm: x[2] }, targetMask, SOFT_K2);

  // 粗网格:中心距 ±200μm,平行度/交错 ±100μm
  let best = [0, 0, 0], bestF = Infinity;
  for (let a = -200; a <= 200; a += 40)
    for (let p = -100; p <= 100; p += 20)
      for (let s = -100; s <= 100; s += 20) {
        const v = f1([a, p, s]);
        if (v < bestF) { bestF = v; best = [a, p, s]; }
      }
  // 第一阶段 NM(软判据)
  const nm1 = nelderMead(f1, best, [15, 8, 8], 300);
  // 第二阶段 NM(锐利判据,从第一阶段结果重启)
  const nm2 = nelderMead(f2, nm1.x, [8, 4, 4], 500);
  const total = nm1.iter + nm2.iter;
  return {
    errors: { dCenterUm: nm2.x[0], slopeParUm: nm2.x[1], slopeSkewUm: nm2.x[2] },
    residual: nm2.fx,
    iterations: total,
  };
}
