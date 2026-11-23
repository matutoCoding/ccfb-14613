/**
 * 装配误差 -> TCA 等效量
 * 圆柱齿轮: 直接采用 ISO 1328 轴线平行度两个分量 + 中心距偏差
 * 锥齿轮: 安装距/轴交角偏差经 Tredgold 一阶映射为虚拟圆柱齿轮误差
 *
 * 锥齿轮映射(节锥顶点为原点, 一阶近似):
 *   啮合点沿小轮锥面法向的分离量 ≈ ΔM1·sinδ1 + ΔM2·sinδ2
 *   接触线沿锥母线的偏斜   ≈ ΔM1·cosδ1 / R + ΔΣ
 */
import type { AssemblyError, GearPair } from './types';
import type { PairDerived } from './pair';

export interface EffectiveErrors {
  /** 中心距偏差 Δa (mm) */
  centerDistance: number;
  /** 中心平面内偏斜 fΣβ (rad) */
  tiltInPlane: number;
  /** 垂直平面内偏斜 fΣδ (rad) */
  tiltCross: number;
}

/** 箱体载荷附加偏斜: 扭矩/刚度, 叠加到中心平面内偏斜 */
export function effectiveErrors(_pair: GearPair, derived: PairDerived, err: AssemblyError): EffectiveErrors {
  const housingTilt =
    err.housingStiffness === Infinity || err.housingStiffness <= 0
      ? 0
      : err.housingTorque / err.housingStiffness;

  if (!derived.isBevel) {
    return {
      centerDistance: err.centerDistanceError,
      tiltInPlane: err.parallelismInPlane + housingTilt,
      tiltCross: err.parallelismCross,
    };
  }

  // 锥齿轮 Tredgold 一阶映射
  const d1 = derived.bevel1!;
  const d2 = derived.bevel2!;
  // 安装距偏差沿节锥法向投影 -> 等效中心距变化
  const centerDistance =
    err.pinionMountingError * Math.sin(d1.pitchAngle) +
    err.gearMountingError * Math.sin(d2.pitchAngle);
  // 面内偏斜只由轴交角误差与箱体载荷产生(安装距的主效应已归入中心距)
  const tiltInPlane = err.shaftAngleError + housingTilt;
  // 交错方向: 安装距在垂直平面的分量近似(二阶小量, 保留方向辨识能力)
  const tiltCross =
    err.parallelismCross +
    (err.gearMountingError * Math.cos(d2.pitchAngle) -
      err.pinionMountingError * Math.cos(d1.pitchAngle)) /
      (d1.outerConeDistance + d2.outerConeDistance);

  return { centerDistance, tiltInPlane, tiltCross };
}
