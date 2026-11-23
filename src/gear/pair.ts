/**
 * 齿轮副派生数据: 统一圆柱/锥齿轮, 向 TCA 提供虚拟圆柱齿轮与布局信息
 */
import type { GearPair, GearParams } from './types';
import { deriveGear, type DerivedGear } from './geometry';
import { deriveBevel, toVirtualGear, type BevelDerived } from './bevel';

export interface PairDerived {
  pair: GearPair;
  /** 参与 TCA 的虚拟圆柱齿轮 (圆柱齿轮即自身) */
  pinionV: GearParams;
  gearV: GearParams;
  d1: DerivedGear;
  d2: DerivedGear;
  /** 名义中心距 a (mm) */
  centerDistance: number;
  /** 基圆半径比决定的传动比 (无侧隙理想) */
  ratio: number;
  /** 锥齿轮派生量 (圆柱为 null) */
  bevel1: BevelDerived | null;
  bevel2: BevelDerived | null;
  isBevel: boolean;
}

export function derivePair(pair: GearPair): PairDerived {
  const isBevel = pair.pinion.kind === 'bevel';
  const pinionV = isBevel ? toVirtualGear(pair.pinion, pair.gear.teeth) : pair.pinion;
  const gearV = isBevel ? toVirtualGear(pair.gear, pair.pinion.teeth) : pair.gear;
  const d1 = deriveGear(pinionV);
  const d2 = deriveGear(gearV);
  const centerDistance =
    pair.nominalCenterDistance > 0 ? pair.nominalCenterDistance : d1.r + d2.r;
  return {
    pair,
    pinionV,
    gearV,
    d1,
    d2,
    centerDistance,
    ratio: d2.rb / d1.rb,
    bevel1: isBevel ? deriveBevel(pair.pinion, pair.gear.teeth) : null,
    bevel2: isBevel ? deriveBevel(pair.gear, pair.pinion.teeth) : null,
    isBevel,
  };
}

/** 端面重合度(粗略, 供 UI/步进步数参考) */
export function contactRatio(derived: PairDerived): number {
  const { d1, d2, centerDistance } = derived;
  const aw = Math.acos((d1.rb + d2.rb) / centerDistance);
  const z1 = derived.pinionV.teeth;
  const z2 = derived.gearV.teeth;
  const epsA =
    (z1 * (Math.tan(aw) - Math.tan(d1.alphaT)) +
      z2 * (Math.tan(aw) - Math.tan(d2.alphaT))) /
    (2 * Math.PI);
  return Math.abs(epsA);
}
