/**
 * WebGPU 设备与间隙场计算调度。无 WebGPU 时返回 null,调用方回退 CPU。
 */
import { GAPFIELD_WGSL, type GapUniformData } from './gapfield-wgsl';

let devicePromise: Promise<GPUDevice | null> | null = null;

export function getDevice(): Promise<GPUDevice | null> {
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        if (!('gpu' in navigator) || !navigator.gpu) return null;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        return await adapter.requestDevice();
      } catch {
        return null;
      }
    })();
  }
  return devicePromise;
}

export async function computeGapFieldGPU(
  u: GapUniformData,
  topo: Float32Array | null,
): Promise<Float32Array | null> {
  const device = await getDevice();
  if (!device) return null;
  const nF = u.nFace, nP = u.nProfile;
  const count = nF * nP;

  const uniform = new ArrayBuffer(8 * 16); // 8 × vec4
  const f32 = new Float32Array(uniform);
  const u32 = new Uint32Array(uniform);
  f32.set([u.dCenter, u.slopePar, u.slopeSkew, u.sinAlpha], 0);
  f32.set(u.m1, 4);
  f32.set(u.m1b, 8);
  f32.set(u.m2, 12);
  f32.set(u.m2b, 16);
  f32.set(u.geo, 20);
  f32.set(u.geo2, 24);
  u32.set([nF, nP, u.hasTopo ? 1 : 0, 0], 28);

  const uniformBuf = device.createBuffer({ size: uniform.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniformBuf, 0, uniform);

  const topoBuf = device.createBuffer({ size: Math.max(4, count * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  if (topo) device.queue.writeBuffer(topoBuf, 0, topo.buffer as ArrayBuffer, topo.byteOffset, topo.byteLength);

  const gapBuf = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const module = device.createShaderModule({ code: GAPFIELD_WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: topoBuf } },
      { binding: 2, resource: { buffer: gapBuf } },
    ],
  });

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(nF / 8), Math.ceil(nP / 8));
  pass.end();
  enc.copyBufferToBuffer(gapBuf, 0, readBuf, 0, count * 4);
  device.queue.submit([enc.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  uniformBuf.destroy(); topoBuf.destroy(); gapBuf.destroy(); readBuf.destroy();
  return out;
}
