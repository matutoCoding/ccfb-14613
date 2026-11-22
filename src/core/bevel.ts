/**
 * 格里森制锥齿轮:基本参数计算 + 当量圆柱齿轮(Tredgold 近似)。
 * 啮合仿真在"中点当量圆柱齿轮副"上进行,安装距偏差折算为当量误差。
 */
import type { GearPairParams, BevelParams } from './types';
import { DEG } from './involute';

export interface BevelGeometry {
  delta1: number;   // 小轮分锥角 rad
  delta2: number;   // 大轮分锥角 rad
  R: number;        // 外锥距 mm
  Rm: number;       // 中点锥距 mm
  mtOuter: number;  // 大端端面模数
  mm: number;       // 中点法向模数
  zv1: number;      // 小轮当量齿数
  zv2: number;
  /** 齿宽中点当量圆柱齿轮副中心距 */
  aEquiv: number;
}

export function bevelGeometry(pair: GearPairParams): BevelGeometry {
  const bp: BevelParams = pair.bevel ?? { shaftAngle: 90, spiralAngle: 35 };
  const sigma = bp.shaftAngle * DEG;
  const z1 = pair.pinion.teeth, z2 = pair.gear.teeth;
  // 分锥角(轴交角 90° 及一般情况)
  const delta1 = Math.atan(Math.sin(sigma) / (z2 / z1 + Math.cos(sigma)));
  const delta2 = sigma - delta1;
  const mtOuter = pair.pinion.module; // 锥齿轮模数按大端端面模数录入
  const R = (mtOuter * z1) / 2 / Math.sin(delta1);
  const B = pair.pinion.faceWidth;
  const Rm = R - B / 2;
  const mm = mtOuter * (Rm / R) * Math.cos(bp.spiralAngle * DEG); // 中点法向模数
  const zv1 = z1 / Math.cos(delta1);
  const zv2 = z2 / Math.cos(delta2);
  const rv1 = (mm / Math.cos(bp.spiralAngle * DEG)) * zv1 / 2;
  const rv2 = (mm / Math.cos(bp.spiralAngle * DEG)) * zv2 / 2;
  return { delta1, delta2, R, Rm, mtOuter, mm, zv1, zv2, aEquiv: rv1 + rv2 };
}

/**
 * 把锥齿轮副转成等效圆柱齿轮副参数(供统一 TCA 使用)。
 * 安装距偏差折算:
 *  - 沿轴线移动 ΔH,接触区沿齿宽移动,同时改变当量中心距:
 *    Δa_eq = ΔH1·sinδ1 + ΔH2·sinδ2  (μm)
 *  - 剩余分量造成对角接触,折算为当量交错:
 *    fy_eq = (ΔH1·cosδ1 − ΔH2·cosδ2)·sinβm · B/Rm (μm, 全齿宽)
 * 工程近似,方向与手算一致:小轮安装距增大 → 接触区移向小端(齿顶方向由螺旋角决定)。
 */
export function bevelToCylindrical(pair: GearPairParams): GearPairParams {
  const bg = bevelGeometry(pair);
  const bp = pair.bevel!;
  const mk = (g: typeof pair.pinion, zv: number): typeof g => ({
    ...g,
    module: bg.mm,
    teeth: Math.max(4, Math.round(zv)),
    helixAngle: bp.spiralAngle,
    // 当量齿数非整数时保留模数/齿数积不变,用变位微调分度圆半径
    profileShift: g.profileShift,
  });
  return {
    ...pair,
    type: 'cylindrical',
    pinion: mk(pair.pinion, bg.zv1),
    gear: mk(pair.gear, bg.zv2),
    centerDistance: bg.aEquiv,
  };
}

/** 安装距偏差 → 当量中心距/交错误差 (μm) */
export function mountingToEquivalent(
  pair: GearPairParams,
  dH1um: number,
  dH2um: number,
): { dCenterUm: number; dSkewUm: number } {
  const bg = bevelGeometry(pair);
  const bp = pair.bevel!;
  const um = 1; // 全程 μm
  const dCenter = (dH1um * Math.sin(bg.delta1) + dH2um * Math.sin(bg.delta2)) * um;
  const dSkew =
    (dH1um * Math.cos(bg.delta1) - dH2um * Math.cos(bg.delta2)) *
    Math.sin(bp.spiralAngle * DEG) *
    (pair.pinion.faceWidth / bg.Rm) * um;
  return { dCenterUm: dCenter, dSkewUm: dSkew };
}
