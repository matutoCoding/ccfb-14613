/**
 * 仿真编排:把存储实体(齿轮副/修形/装配误差)装配成 TCA 输入,
 * 优先 WebGPU 算间隙场,失败回退 CPU;然后斑点、传动误差、加载接触。
 */
import type {
  GearPairParams, ModificationSpec, AssemblyError, SimSettings, GapFieldResult,
} from './types';
import { gearGeometry, meshGeometry } from './involute';
import { bevelToCylindrical, mountingToEquivalent } from './bevel';
import { computeGapField, analyzeGapField, gridXi, toothCoords, type TcaInput } from './tca';
import { loadedContact } from './load';
import { computeGapFieldGPU } from '../gpu/webgpu';
import { topologyAt } from './modification';

export interface SimResult {
  result: GapFieldResult;
  backend: 'webgpu' | 'cpu';
  tca: TcaInput;
}

export function buildTcaInput(
  pair: GearPairParams,
  modP: ModificationSpec | null,
  modG: ModificationSpec | null,
  err: AssemblyError | null,
  settings: SimSettings,
): TcaInput {
  // 锥齿轮 → 当量圆柱齿轮副
  const cyl = pair.type === 'bevel' ? bevelToCylindrical(pair) : pair;
  const g1 = gearGeometry(cyl.pinion);
  const g2 = gearGeometry(cyl.gear);

  let dCenterUm = (err?.centerDistance ?? 0);
  let slopeParUm = (err?.parallelism ?? 0) + (err?.housingParallelism ?? 0);
  let slopeSkewUm = (err?.skew ?? 0) + (err?.housingSkew ?? 0);
  if (pair.type === 'bevel' && err) {
    const eq = mountingToEquivalent(pair, err.mountingPinion, err.mountingGear);
    dCenterUm += eq.dCenterUm;
    slopeSkewUm += eq.dSkewUm;
  }

  // 网格覆盖名义接触窗口 ± 0.6 基节余量(容纳窗口移动与齿廓全貌)
  const aNominal = cyl.centerDistance ?? g1.r + g2.r;
  const mesh = meshGeometry(g1, g2, aNominal);
  const margin = 0.6 * g1.pbt;
  const xiGridMin = mesh.xiMin - margin;
  const xiGridMax = mesh.xiMax + margin;

  return {
    mesh,
    pbt: g1.pbt,
    rb1: g1.rb,
    rb2: g2.rb,
    faceWidth: cyl.pinion.faceWidth,
    xiGridMin,
    xiGridMax,
    errors: { dCenterUm, slopeParUm, slopeSkewUm },
    modPinion: modP,
    modGear: modG,
    settings,
  };
}

export async function runSimulation(
  pair: GearPairParams,
  modP: ModificationSpec | null,
  modG: ModificationSpec | null,
  err: AssemblyError | null,
  settings: SimSettings,
  withLoad = true,
): Promise<SimResult> {
  const tca = buildTcaInput(pair, modP, modG, err, settings);
  const nF = settings.faceSections, nP = settings.profileSamples;

  // 拓扑网格预插值(小轮 + 大轮,牙齿坐标)
  let topo: Float32Array | null = null;
  if (modP?.topology || modG?.topology) {
    topo = new Float32Array(nF * nP);
    for (let i = 0; i < nF; i++) {
      const t = i / (nF - 1);
      for (let j = 0; j < nP; j++) {
        const s = j / (nP - 1);
        const { sPin, sGear } = toothCoords(tca, gridXi(tca, s));
        topo[i * nP + j] =
          (modP?.topology ? topologyAt(modP, t, sPin) : 0) +
          (modG?.topology ? topologyAt(modG, t, sGear) : 0);
      }
    }
  }

  const sinA = Math.sin(tca.mesh.alphaT1);
  const pack = (m: ModificationSpec | null): { v: number[]; vb: number[] } => ({
    v: [m?.crowning ?? 0, m?.endReliefAmount ?? 0, m ? m.endReliefLength / tca.faceWidth : 0, m?.tipReliefAmount ?? 0],
    vb: [m?.tipReliefStart ?? 1, m?.profileCrowning ?? 0, m?.helixCorrection ?? 0, 0],
  });
  const p1 = pack(modP), p2 = pack(modG);
  const m = tca.mesh;

  let gap: Float32Array | null = null;
  let backend: 'webgpu' | 'cpu' = 'cpu';
  try {
    gap = await computeGapFieldGPU(
      {
        dCenter: tca.errors.dCenterUm, slopePar: tca.errors.slopeParUm, slopeSkew: tca.errors.slopeSkewUm,
        sinAlpha: sinA,
        m1: p1.v, m1b: p1.vb, m2: p2.v, m2b: p2.vb,
        geo: [tca.xiGridMin, tca.xiGridMax - tca.xiGridMin, m.xiForm1, m.tipRoll1 - m.xiForm1],
        geo2: [m.t1t2, m.xiForm2, m.tipRoll2 - m.xiForm2, 0],
        nFace: nF, nProfile: nP, hasTopo: !!topo,
      },
      topo,
    );
    if (gap) backend = 'webgpu';
  } catch {
    gap = null;
  }
  if (!gap) {
    gap = computeGapField(tca).gap;
  }

  const result = analyzeGapField(tca, { gap, nFace: nF, nProfile: nP });
  if (withLoad) {
    result.loaded = loadedContact(tca, { gap, nFace: nF, nProfile: nP }, settings.torque);
  }
  return { result, backend, tca };
}
