/**
 * 锥齿轮(格里森制基本参数) —— Tredgold 虚拟圆柱齿轮近似
 * 适用范围: 轴交角 Σ, 直齿/弧齿锥齿轮的接触斑点与传动误差一阶分析;
 * 局部共轭效应(失配、刀盘半径影响)通过虚拟齿轮的修形通道表达。
 */
import type { GearParams } from './types';

export interface BevelDerived {
  /** 分锥角 δ */
  pitchAngle: number;
  /** 外锥距 R */
  outerConeDistance: number;
  /** 中点锥距 Rm */
  meanConeDistance: number;
  /** 背锥距(虚拟齿轮半径) Rv = R / cos δ */
  virtualRadius: number;
  /** 虚拟齿数 zv = z / cos δ */
  virtualTeeth: number;
  /** 虚拟齿轮螺旋角 = 中点螺旋角 */
  virtualHelix: number;
  /** 虚拟齿轮模数 mv = 2 Rv / zv (= mt / cosδ) */
  virtualModule: number;
  /** 安装距 */
  mountingDistance: number;
  /** 齿宽方向沿节锥母线坐标范围 [0,b], 0=内端 */
  sRange: [number, number];
}

/** 由配对齿数比和轴交角计算分锥角: tan δ1 = sinΣ / (u + cosΣ), u=z2/z1 */
export function pitchAngleFromRatio(teethPinion: number, teethGear: number, shaftAngle: number): number {
  const u = teethGear / teethPinion;
  return Math.atan2(Math.sin(shaftAngle), u + Math.cos(shaftAngle));
}

export function deriveBevel(g: GearParams, mateTeeth: number): BevelDerived {
  if (!g.bevel) throw new Error(`${g.name}: 缺少锥齿轮参数`);
  const pitchAngle =
    g.bevel.pitchAngle > 0
      ? g.bevel.pitchAngle
      : pitchAngleFromRatio(g.teeth, mateTeeth, g.bevel.shaftAngle);
  const R = g.bevel.outerConeDistance;
  const b = g.faceWidth;
  const Rm = R - b / 2;
  const Rv = R / Math.cos(pitchAngle);
  const zv = g.teeth / Math.cos(pitchAngle);
  const mv = (2 * Rv) / zv;
  return {
    pitchAngle,
    outerConeDistance: R,
    meanConeDistance: Rm,
    virtualRadius: Rv,
    virtualTeeth: zv,
    virtualHelix: g.bevel.spiralAngle,
    virtualModule: mv,
    mountingDistance: g.bevel.mountingDistance,
    sRange: [0, b],
  };
}

/**
 * 把锥齿轮映射为虚拟圆柱齿轮(继承原 id, 模块内复用全部圆柱齿轮/TCA 流程)
 */
export function toVirtualGear(g: GearParams, mateTeeth: number): GearParams {
  const bd = deriveBevel(g, mateTeeth);
  return {
    ...g,
    kind: 'cylindrical',
    module: bd.virtualModule,
    teeth: g.teeth, // 齿数保持真实值, 螺旋角/压力角为虚拟值
    pressureAngle: g.pressureAngle,
    helixAngle: bd.virtualHelix,
    faceWidth: g.faceWidth,
    bevel: g.bevel, // 保留原始锥参数
  };
}

/** 虚拟圆柱齿轮 z 坐标 -> 锥齿轮节锥母线上的距离 s (中点为 0) */
export function virtualZToConeS(g: GearParams, z: number): number {
  return z + g.faceWidth / 2;
}
