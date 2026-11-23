/**
 * 啮合仿真 GPU 引擎 (WebGPU Compute)
 * 间隙场每个格点独立计算, 天然适合 GPU 并行;
 * 不支持 WebGPU 时自动回退到 CPU 实现(数学完全一致, 见 tca.buildGrid)
 */
import type { FlankSide } from '../gear/types';
import type { PairDerived } from '../gear/pair';
import type { ModificationPlan } from '../gear/modification';
import type { EffectiveErrors } from '../gear/assembly';
import { buildGrid, type TcaGrid } from '../gear/tca';

export interface GpuContext {
  device: GPUDevice;
}

export async function detectWebGPU(): Promise<GpuContext | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    return { device };
  } catch {
    return null;
  }
}

/** WGSL: 与 tca.errorGap/modificationAt 同构的间隙场核函数
 * 注意: uniform 地址空间要求 16 字节对齐, 所有标量按 vec4 分组排列 */
const WGSL = /* wgsl */ `
struct Params {
  g0: vec4<f32>, // nS, nZ, sLo, sHi
  g1: vec4<f32>, // bHalf, alphaT, rb1, rb2
  g2: vec4<f32>, // uP1, uP2, betaB1, betaB2
  g3: vec4<f32>, // faceW2, depth1, depth2, ra1
  g4: vec4<f32>, // ra2, rf1, rf2, dCenter
  g5: vec4<f32>, // tiltIn, tiltCross, redLeadUm, faceW1
  m1v: vec4<f32>, // crown1, relief1, reliefLen1, tip1
  m2v: vec4<f32>, // tipDepth1, helix1, crown2, relief2
  m3v: vec4<f32>, // reliefLen2, tip2, tipDepth2, helix2
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> outGap: array<f32>;
@group(0) @binding(2) var<storage, read_write> outIntensity: array<f32>;

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
  var t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nS = u32(P.g0.x);
  let nZ = u32(P.g0.y);
  if (gid.x >= nS || gid.y >= nZ) { return; }
  let idx = gid.x * nZ + gid.y;
  let s = P.g0.z + (P.g0.w - P.g0.z) * (f32(gid.x) / f32(nS - 1u));
  let zeta = -P.g1.x + 2.0 * P.g1.x * (f32(gid.y) / f32(nZ - 1u));
  let alphaT = P.g1.y;
  let rb1 = P.g1.z;
  let rb2 = P.g1.w;
  let uP1 = P.g2.x;
  let uP2 = P.g2.y;
  let betaB1 = P.g2.z;
  let betaB2 = P.g2.w;
  let faceW2 = P.g3.x;
  let depth1 = P.g3.y;
  let depth2 = P.g3.z;
  let ra1 = P.g3.w;
  let ra2 = P.g4.x;
  let rf1 = P.g4.y;
  let rf2 = P.g4.z;
  let dCenter = P.g4.w;
  let tiltIn = P.g5.x;
  let tiltCross = P.g5.y;
  let redLeadUm = P.g5.z;
  let faceW1 = P.g5.w;

  // 接触几何
  let q1 = rb1 * uP1 + s;
  let r1 = sqrt(rb1 * rb1 + q1 * q1);
  let q2 = rb1 * uP1 + rb2 * uP2 - q1;
  let r2 = sqrt(rb2 * rb2 + q2 * q2);
  var z2 = 0.0;
  if (abs(betaB1) > 1e-9) {
    z2 = -(zeta * tan(betaB1) / rb1) * (rb2 / tan(betaB2));
  }
  let rho1 = clamp((ra1 - r1) / depth1, 0.0, 1.0);
  let rho2 = clamp((r2 - max(rb2, rf2)) / depth2, 0.0, 1.0);
  let bHalf = P.g1.x;
  let zb1 = zeta / bHalf;
  let zb2 = z2 / (faceW2 * 0.5);

  // 修形(μm 累加, 末尾转 mm)
  var modVal = 0.0;
  modVal = modVal + P.m1v.x * zb1 * zb1 + P.m2v.z * zb2 * zb2;
  let start1 = faceW1 * 0.5 - P.m1v.z;
  let t1 = smoothstep(start1, faceW1 * 0.5, abs(zb1) * faceW1 * 0.5);
  modVal = modVal + P.m1v.y * t1 * t1;
  let start2 = faceW2 * 0.5 - P.m3v.x;
  let t2 = smoothstep(start2, faceW2 * 0.5, abs(zb2) * faceW2 * 0.5);
  modVal = modVal + P.m2v.w * t2 * t2;
  let tt1 = 1.0 - smoothstep(0.0, P.m2v.x, rho1 * depth1);
  modVal = modVal + P.m1v.w * tt1 * tt1;
  let tt2 = 1.0 - smoothstep(0.0, P.m3v.z, rho2 * depth2);
  modVal = modVal + P.m3v.y * tt2 * tt2;
  modVal = modVal + P.m2v.y * zb1 + P.m3v.w * zb2;
  let modMm = modVal * 0.001;

  // 装配误差线性化间隙
  let st = sin(alphaT);
  let ct = cos(alphaT);
  let gCenter = dCenter * st;
  let xContact = r1 * st + s * st;
  let gIn = tiltIn * (zeta * st - xContact * ct);
  let gCross = -tiltCross * zeta * ct;
  let gap = modMm + gCenter + gIn + gCross;
  outGap[idx] = gap;

  // 红丹着色
  let threshold = redLeadUm * 0.001;
  if (gap <= threshold) {
    outIntensity[idx] = max(0.0, 1.0 - max(0.0, gap) / threshold);
  } else {
    outIntensity[idx] = 0.0;
  }
}
`;

export class GpuEngine {
  private constructor(private ctx: GpuContext) {}

  static async create(): Promise<GpuEngine | null> {
    const ctx = await detectWebGPU();
    if (!ctx) return null;
    // Shader 编译预检, 编译失败则视为 GPU 不可用
    const module = ctx.device.createShaderModule({ code: WGSL });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      console.error('WGSL 编译错误:', errors.map((m) => m.message).join('; '));
      return null;
    }
    return new GpuEngine(ctx);
  }

  async computeGapField(
    derived: PairDerived,
    plan: ModificationPlan,
    side: FlankSide,
    eff: EffectiveErrors,
    nS: number,
    nZ: number,
  ): Promise<{ gap: Float64Array; intensity: Float64Array }> {
    const device = this.ctx.device;
    const module = device.createShaderModule({ code: WGSL });
    const pad = (n: number): number => {
      const u = Math.ceil(n / 8);
      return u * 8;
    };
    const nSP = pad(nS);
    const nZP = pad(nZ);
    const count = nSP * nZP;

    const { d1, d2 } = derived;
    const m1 = plan.pinion[side];
    const m2 = plan.gear[side];
    const [sLo, sHi] = ((): [number, number] => {
      const qP2 = d2.rb * d2.uPitch;
      const q2Tip = Math.sqrt(Math.max(0, d2.ra * d2.ra - d2.rb * d2.rb));
      const q1Tip = Math.sqrt(Math.max(0, d1.ra * d1.ra - d1.rb * d1.rb));
      return [qP2 - q2Tip, q1Tip - d1.rb * d1.uPitch];
    })();

    // 9 个 vec4 分组, 与 WGSL Params 严格对应 (共 144 字节, 16 字节对齐)
    const groups: number[][] = [
      // g0: nS, nZ, sLo, sHi
      [nS, nZ, sLo, sHi],
      // g1: bHalf, alphaT, rb1, rb2
      [derived.pinionV.faceWidth / 2, d1.alphaT, d1.rb, d2.rb],
      // g2: uP1, uP2, betaB1, betaB2
      [d1.uPitch, d2.uPitch, d1.betaB, d2.betaB],
      // g3: faceW2, depth1, depth2, ra1
      [derived.gearV.faceWidth, d1.ra - Math.max(d1.rb, d1.rf), d2.ra - Math.max(d2.rb, d2.rf), d1.ra],
      // g4: ra2, rf1, rf2, dCenter
      [d2.ra, d1.rf, d2.rf, eff.centerDistance],
      // g5: tiltIn, tiltCross, redLeadUm, faceW1
      [eff.tiltInPlane, eff.tiltCross, plan.redLeadThickness, derived.pinionV.faceWidth],
      // m1v: crown1, relief1, reliefLen1, tip1
      [m1.leadCrown, m1.endRelief, m1.endReliefLength, m1.tipRelief],
      // m2v: tipDepth1, helix1, crown2, relief2
      [m1.tipReliefDepth, m1.helixCorrection, m2.leadCrown, m2.endRelief],
      // m3v: reliefLen2, tip2, tipDepth2, helix2
      [m2.endReliefLength, m2.tipRelief, m2.tipReliefDepth, m2.helixCorrection],
    ];
    const uniformArray = new Float32Array(groups.flat());
    const uniformBuffer = device.createBuffer({
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    const gapBuffer = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const intensityBuffer = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: gapBuffer } },
        { binding: 2, resource: { buffer: intensityBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(nSP / 8), Math.ceil(nZP / 8));
    pass.end();

    const readGap = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const readInt = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(gapBuffer, 0, readGap, 0, count * 4);
    encoder.copyBufferToBuffer(intensityBuffer, 0, readInt, 0, count * 4);
    device.queue.submit([encoder.finish()]);

    await Promise.all([readGap.mapAsync(GPUMapMode.READ), readInt.mapAsync(GPUMapMode.READ)]);
    const gapF32 = new Float32Array(readGap.getMappedRange().slice(0));
    const intF32 = new Float32Array(readInt.getMappedRange().slice(0));
    readGap.unmap();
    readInt.unmap();

    const gap = new Float64Array(nS * nZ);
    const intensity = new Float64Array(nS * nZ);
    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nZ; j++) {
        gap[i * nZ + j] = gapF32[i * nZP + j];
        intensity[i * nZ + j] = intF32[i * nZP + j];
      }
    }
    return { gap, intensity };
  }
}

/**
 * 统一入口: GPU 可用走 GPU, 否则 CPU 回退
 * 返回与 buildGrid 同构的网格(CPU 路径直接复用, 保证结果一致)
 */
export async function computeGrid(
  engine: GpuEngine | null,
  derived: PairDerived,
  plan: ModificationPlan,
  side: FlankSide,
  eff: EffectiveErrors,
  nS: number,
  nZ: number,
): Promise<TcaGrid> {
  if (engine) {
    try {
      const { gap } = await engine.computeGapField(derived, plan, side, eff, nS, nZ);
      const cpu = buildGrid(derived, plan, side, eff, { nS, nZ });
      // GPU/CPU 对账: 最大偏差超过 10nm 视为 GPU 异常, 拒绝采用并回退
      let maxDiff = 0;
      for (let k = 0; k < gap.length; k++) {
        maxDiff = Math.max(maxDiff, Math.abs(gap[k] - cpu.clearance[k]));
      }
      if (maxDiff > 1e-5) {
        console.warn(`WebGPU 与 CPU 结果偏差 ${maxDiff.toExponential(2)} mm 超限, 回退 CPU`);
      } else {
        cpu.clearance.set(gap);
        return cpu;
      }
    } catch (e) {
      console.warn('WebGPU 计算失败, 回退 CPU:', e);
    }
  }
  return buildGrid(derived, plan, side, eff, { nS, nZ });
}
