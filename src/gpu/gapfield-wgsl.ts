/**
 * WebGPU 间隙场计算:WGSL 与 core/tca.ts 的 gapAt() 逐行对应,改动必须两边同步。
 * 拓扑网格修形量由 CPU 预插值到 (nFace×nProfile) 缓冲区,GPU 直接叠加。
 */

export const GAPFIELD_WGSL = /* wgsl */ `
struct Uniforms {
  err: vec4<f32>,   // dCenter, slopePar, slopeSkew, sinAlpha
  m1: vec4<f32>,    // 小轮: crowning, endAmount, endE, tipAmount
  m1b: vec4<f32>,   // tipStart, profileCrowning, helixCorr, unused
  m2: vec4<f32>,    // 大轮
  m2b: vec4<f32>,
  geo: vec4<f32>,   // xiGridMin, gridSpan, xiForm1, span1(形圆→齿顶)
  geo2: vec4<f32>,  // t1t2, xiForm2, span2, unused
  dims: vec4<u32>,  // nFace, nProfile, hasTopo, unused
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> topo: array<f32>;
@group(0) @binding(2) var<storage, read_write> gapOut: array<f32>;

fn leadMod(m: vec4<f32>, mb: vec4<f32>, t: f32) -> f32 {
  var d = m.x * 4.0 * (t - 0.5) * (t - 0.5);      // 鼓形
  let e = m.z;
  if (m.y > 0.0 && e > 0.0) {                      // 齿端修薄
    if (t < e) { d += m.y * (1.0 - t / e); }
    else if (t > 1.0 - e) { d += m.y * (1.0 - (1.0 - t) / e); }
  }
  d += mb.z * (t - 0.5);                           // 螺旋角修正
  return d;
}

fn profMod(m: vec4<f32>, mb: vec4<f32>, s: f32) -> f32 {
  var d = 0.0;
  if (m.w > 0.0 && s > mb.x) {                     // 齿顶修缘
    let uu = (s - mb.x) / max(1e-6, 1.0 - mb.x);
    d += m.w * uu * uu;
  }
  d += mb.y * 4.0 * (s - 0.5) * (s - 0.5);         // 齿形鼓形
  return d;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nF = u.dims.x;
  let nP = u.dims.y;
  let i = gid.x; // 齿向
  let j = gid.y; // 齿廓
  if (i >= nF || j >= nP) { return; }
  let t = select(0.5, f32(i) / f32(nF - 1u), nF > 1u);
  let s = select(0.5, f32(j) / f32(nP - 1u), nP > 1u);

  var g = u.err.x * u.err.w;
  g += u.err.y * (t - 0.5) * u.err.w;
  g += u.err.z * (t - 0.5);
  // 网格坐标 → 啮合线坐标 → 牙齿坐标(修形锚定在牙齿上)
  let xi = u.geo.x + s * u.geo.y;
  let sPin = clamp((xi - u.geo.z) / max(1e-9, u.geo.w), 0.0, 1.0);
  let sGear = clamp(((u.geo2.x - xi) - u.geo2.y) / max(1e-9, u.geo2.z), 0.0, 1.0);
  g += leadMod(u.m1, u.m1b, t) + profMod(u.m1, u.m1b, sPin);
  g += leadMod(u.m2, u.m2b, t) + profMod(u.m2, u.m2b, sGear);
  if (u.dims.z == 1u) {
    g += topo[i * nP + j];
  }
  gapOut[i * nP + j] = g;
}
`;

export interface GapUniformData {
  dCenter: number; slopePar: number; slopeSkew: number; sinAlpha: number;
  m1: number[];  // [crowning, endAmount, endE, tipAmount]
  m1b: number[]; // [tipStart, profileCrowning, helixCorr, 0]
  m2: number[];
  m2b: number[];
  geo: number[];  // [xiGridMin, gridSpan, xiForm1, span1]
  geo2: number[]; // [t1t2, xiForm2, span2, 0]
  nFace: number; nProfile: number; hasTopo: boolean;
}
