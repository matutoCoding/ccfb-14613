/**
 * 啮合仿真页面
 * GPU/CPU 切换, 工作面/非工作面, 间隙场+红丹斑点+轻/满载应力, TE 曲线与指标
 */
import { getState, saveSimulation, setGpu, setSide } from '../../db/store';
import { simulationService } from '../../sim/simulationService';
import { detectWebGPU } from '../../sim/gpuEngine';
import { DEFAULT_LOAD, type LoadCase, type GearPair, type AssemblyError } from '../../gear/types';
import { rad2deg } from '../../gear/math3d';
import { ensurePlan } from './modificationPage';
import { h, labeledField, numInput, toast } from '../dom';
import { HeatmapView } from '../heatmap';
import { LineChart } from '../lineChart';
import type { SimulationRecord } from '../../db/records';

export function simulationPage(): HTMLElement {
  const state = getState();
  const pairMaybe = state.pairs.find((p) => p.id === state.currentPairId);
  const root = h('div', { class: 'page page-wide' });
  if (!pairMaybe) return h('div', { class: 'empty' }, '请先创建齿轮副');
  const pair: GearPair = pairMaybe;

  const plan = state.plans.find((p) => p.id === state.currentPlanId && p.pairId === pair.id) ?? ensurePlan(pair.id);
  const asmMaybe = state.assemblies.find((a) => a.id === state.currentAssemblyId && a.pairId === pair.id);
  if (!asmMaybe) return h('div', { class: 'empty' }, '请先在装配误差页面创建误差方案(可全零)');
  const asm: AssemblyError = asmMaybe;

  const load: LoadCase = { ...DEFAULT_LOAD };
  const gapView = new HeatmapView(460, 340);
  const patternView = new HeatmapView(460, 340);
  const stressView = new HeatmapView(460, 340);
  const teChart = new LineChart(720, 300);

  const status = h('div', { class: 'status-line' }, '就绪');
  const metricBox = h('div', { class: 'kv' });

  async function initGpu(): Promise<void> {
    const gpu = await detectWebGPU();
    setGpu(gpu !== null, gpu !== null);
    const chip = document.getElementById('gpu-chip');
    if (chip) chip.textContent = gpu ? 'WebGPU 可用' : 'WebGPU 不可用 · CPU 模式';
    chip?.classList.toggle('chip-ok', gpu !== null);
  }
  void initGpu();

  async function run(): Promise<void> {
    status.textContent = '仿真计算中…';
    try {
      const out = await simulationService.run(pair, plan, asm, state.currentSide, {
        nS: 48,
        nZ: 48,
        steps: 120,
        load,
        useGpu: getState().useGpu,
      });
      await saveSimulation(out.record);
      renderRecord(out.record);
      status.textContent = `完成 (${out.gpuUsed ? 'WebGPU' : 'CPU'}, 耗时 ${out.elapsedMs.toFixed(0)} ms)`;
      toast('仿真完成并已保存', 'ok');
    } catch (e) {
      status.textContent = '仿真失败';
      toast((e as Error).message, 'error');
    }
  }

  const viewMode: { load: 'light' | 'full' } = { load: 'full' };
  let currentRec: SimulationRecord | null = null;

  function renderRecord(rec: SimulationRecord): void {
    currentRec = rec;
    const sArr = Float64Array.from(rec.sAxis);
    const zArr = Float64Array.from(rec.zAxis);
    gapView.render(Float64Array.from(rec.clearance), rec.nS, rec.nZ, sArr, zArr, {
      title: '法向间隙场 (mm)',
      mode: 'clearance',
      xLabel: '齿宽 ζ (mm)',
      yLabel: '作用线 s (mm)',
    });
    patternView.render(Float64Array.from(rec.intensity), rec.nS, rec.nZ, sArr, zArr, {
      title: `红丹接触斑点 · ${state.currentSide === 'working' ? '工作面' : '非工作面'}`,
      mode: 'redlead',
      xLabel: '齿宽 ζ (mm)',
      yLabel: '作用线 s (mm)',
    });
    const pressure = viewMode.load === 'full' ? rec.pressureFull : rec.pressureLight;
    stressView.render(Float64Array.from(pressure), rec.nS, rec.nZ, sArr, zArr, {
      title: `${viewMode.load === 'full' ? '满载' : '轻载(25%)'}接触压力 (MPa), 红框=齿端应力集中`,
      mode: 'stress',
      xLabel: '齿宽 ζ (mm)',
      yLabel: '作用线 s (mm)',
      redZones: viewMode.load === 'full' ? rec.redZones : [],
    });
    teChart.render([
      { label: '当前方案 TE', color: '#ff6b5e', points: rec.te.map((p) => ({ x: rad2deg(p.theta1), y: p.te })) },
    ], { title: '传动误差曲线', xLabel: '小轮转角 (°)', yLabel: 'TE (折算小轮)' });

    metricBox.replaceChildren(
      h('span', {}, 'TE 峰峰值'), h('strong', {}, (rec.tePeakToPeak * 1e6).toFixed(2) + ' μrad'),
      h('span', {}, '啮合频率幅值'), h('strong', {}, (rec.teMeshAmplitude * 1e6).toFixed(2) + ' μrad'),
      h('span', {}, '最大接触应力'), h('strong', {}, rec.maxStress.toFixed(1) + ' MPa'),
      h('span', {}, '齿向载荷分布 Kβ'), h('strong', {}, rec.loadDistributionFactor.toFixed(3)),
      h('span', {}, '斑点长度占比'), h('strong', {}, (rec.features.lengthFraction * 100).toFixed(1) + '%'),
      h('span', {}, '斑点高度占比'), h('strong', {}, (rec.features.heightFraction * 100).toFixed(1) + '%'),
    );
  }

  // 历史记录回放
  const historySel = h('select', {
    onchange: (e: Event) => {
      const rec = getState().simulations.find((r) => r.id === (e.target as HTMLSelectElement).value);
      if (rec) renderRecord(rec);
    },
  }, h('option', { value: '' }, '选择历史仿真…'),
    ...getState().simulations.filter((r) => r.pairId === pair.id).map((r) => new Option(r.name + ' · ' + new Date(r.createdAt).toLocaleTimeString('zh-CN'), r.id)));

  const control = h('div', { class: 'panel' },
    h('div', { class: 'toolbar' },
      h('span', { id: 'gpu-chip', class: 'chip' }, '检测 WebGPU…'),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: true,
          onchange: (e: Event) => setGpu(getState().gpuAvailable, (e.target as HTMLInputElement).checked),
        }), '启用 GPU 计算'),
      h('button', { class: 'btn btn-primary', onclick: () => void run() }, '运行啮合仿真'),
      h('button', {
        class: 'btn',
        onclick: () => {
          const next = state.currentSide === 'working' ? 'nonworking' : 'working';
          setSide(next);
          void run();
        },
      }, `切换到${state.currentSide === 'working' ? '非工作面' : '工作面'}`),
      h('div', { class: 'switch' },
        h('button', {
          class: 'btn' + (viewMode.load === 'light' ? ' btn-primary' : ''),
          onclick: () => { viewMode.load = 'light'; if (currentRec) renderRecord(currentRec); },
        }, '轻载斑点'),
        h('button', {
          class: 'btn' + (viewMode.load === 'full' ? ' btn-primary' : ''),
          onclick: () => { viewMode.load = 'full'; if (currentRec) renderRecord(currentRec); },
        }, '满载斑点'),
      ),
      historySel,
    ),
    h('div', { class: 'form-grid' },
      labeledField('小轮扭矩', numInput(load.torqueNm, 10, (v) => (load.torqueNm = v)), 'N·m'),
      labeledField('转速', numInput(load.rpm, 50, (v) => (load.rpm = v)), 'rpm'),
      labeledField('弹性模量', numInput(load.elasticModulus, 1000, (v) => (load.elasticModulus = v)), 'MPa'),
      labeledField('泊松比', numInput(load.poissonRatio, 0.02, (v) => (load.poissonRatio = v))),
      labeledField('许用应力', numInput(load.allowableStress, 50, (v) => (load.allowableStress = v)), 'MPa'),
    ),
    status,
    metricBox,
  );

  const grids = h('div', { class: 'sim-grid' },
    h('div', { class: 'panel' }, gapView.canvas),
    h('div', { class: 'panel' }, patternView.canvas),
    h('div', { class: 'panel' }, stressView.canvas),
  );
  const tePanel = h('div', { class: 'panel' }, teChart.canvas);

  // 自动回放最近一次
  const latest = getState().simulations.find((r) => r.pairId === pair.id);
  if (latest) renderRecord(latest);

  root.append(control, grids, tePanel);
  return root;
}
