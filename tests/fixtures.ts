/**
 * 测试夹具: 常用齿轮副与默认对象
 */
import type { AssemblyError, GearPair } from '../src/gear/types';
import { deg2rad } from '../src/gear/math3d';
import { defaultPlan } from '../src/gear/modification';
import { uid } from '../src/gear/types';

export function helicalPair(): GearPair {
  return {
    id: 'pair-helical',
    name: '标准斜齿轮副 z21/z43 mn4 β12°',
    updatedAt: 0,
    nominalCenterDistance: 0,
    backlash: 0,
    pinion: {
      id: 'p1',
      name: '小轮',
      kind: 'cylindrical',
      module: 4,
      teeth: 21,
      pressureAngle: deg2rad(20),
      helixAngle: deg2rad(12),
      hand: 'right',
      profileShift: 0,
      faceWidth: 60,
      addendumCoef: 1,
      clearanceCoef: 0.25,
    },
    gear: {
      id: 'g1',
      name: '大轮',
      kind: 'cylindrical',
      module: 4,
      teeth: 43,
      pressureAngle: deg2rad(20),
      helixAngle: deg2rad(12),
      hand: 'left',
      profileShift: 0,
      faceWidth: 56,
      addendumCoef: 1,
      clearanceCoef: 0.25,
    },
  };
}

export function spurPair(): GearPair {
  const p = helicalPair();
  p.name = '直齿轮副';
  p.pinion.helixAngle = 0;
  p.pinion.hand = 'right';
  p.gear.helixAngle = 0;
  p.gear.hand = 'left';
  return p;
}

export function bevelPair(): GearPair {
  const R = 90;
  return {
    id: 'pair-bevel',
    name: '格里森弧齿锥齿轮副 z17/z29',
    updatedAt: 0,
    nominalCenterDistance: 0,
    backlash: 0.15,
    pinion: {
      id: 'bp1',
      name: '小锥轮',
      kind: 'bevel',
      module: 5,
      teeth: 17,
      pressureAngle: deg2rad(20),
      helixAngle: deg2rad(35),
      hand: 'left',
      profileShift: 0,
      faceWidth: 28,
      addendumCoef: 1,
      clearanceCoef: 0.25,
      bevel: {
        shaftAngle: deg2rad(90),
        spiralAngle: deg2rad(35),
        pitchAngle: 0,
        outerConeDistance: R,
        mountingDistance: 120,
        clearanceCoef: 0.25,
      },
    },
    gear: {
      id: 'bg1',
      name: '大锥轮',
      kind: 'bevel',
      module: 5,
      teeth: 29,
      pressureAngle: deg2rad(20),
      helixAngle: deg2rad(35),
      hand: 'right',
      profileShift: 0,
      faceWidth: 28,
      addendumCoef: 1,
      clearanceCoef: 0.25,
      bevel: {
        shaftAngle: deg2rad(90),
        spiralAngle: deg2rad(35),
        pitchAngle: 0,
        outerConeDistance: R,
        mountingDistance: 110,
        clearanceCoef: 0.25,
      },
    },
  };
}

export function zeroErrors(pairId: string): AssemblyError {
  return {
    id: uid('asm'),
    name: '零误差',
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

export function planFor(pairId: string) {
  return defaultPlan(pairId, uid('plan'));
}
