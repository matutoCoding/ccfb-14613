/**
 * 齿面修形页面
 * 四类修形参数表单 + 拓扑网格画布编辑(鼠标拖拽涂刷 μm) + 3D 预览
 */
import type { FlankSide, GearPair } from '../../gear/types';
import { getState, savePlan, setSide } from '../../db/store';
import { defaultPlan, emptyTopology, modificationAt, type ModificationPlan, type ModificationParams } from '../../gear/modification';
import { derivePair } from '../../gear/pair';
import { deriveGear } from '../../gear/geometry';
import { h, labeledField, numInput, toast } from '../dom';
import { HeatmapView } from '../heatmap';
import { Gear3DView } from '../gear3d';
import { uid } from '../../gear/types';

export function modificationPage(): HTMLElement {
  const state = getState();
  const pairMaybe = state.pairs.find((p) => p.id === state.currentPairId);
  const root = h('div', { class: 'page' });
  if (!pairMaybe) return h('div', { class: 'empty' }, '请先在齿轮副页面创建齿轮副');
  const pair: GearPair = pairMaybe;

  let plan =
    state.plans.find((p) => p.id === state.currentPlanId && p.pairId === pair.id) ??
    state.plans.find((p) => p.pairId === pair.id) ??
    defaultPlan(pair.id, uid('plan'));
  let side: FlankSide = state.currentSide;
  let which: 'pinion' | 'gear' = 'pinion';

  const derived = derivePair(pair);
  const d1 = deriveGear(derived.pinionV);

  const heat = new HeatmapView(520, 380);
  const topoCanvas = document.createElement('canvas');
  topoCanvas.width = 480 * devicePixelRatio;
  topoCanvas.height = 300 * devicePixelRatio;
  topoCanvas.style.width = '480px';
  topoCanvas.style.height = '300px';
  topoCanvas.className = 'topo-canvas';
  const view3d = new Gear3DView();

  const left = h('div', { class: 'panel' });
  const center = h('div', { class: 'panel' },
    h('h3', {}, '修形量拓扑 (μm) — 按住鼠标涂刷'),
    topoCanvas,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => { params().topology = emptyTopology(params().topoNR, params().topoNZ); void refresh(); } }, '清空拓扑'),
      h('label', {}, '涂刷值',
        (() => {
          const brush = h('input', { type: 'number', value: '5', step: '1', class: 'brush-input' }) as HTMLInputElement;
          brush.dataset.role = 'brush';
          return brush;
        })(),
        'μm'),
    ),
  );
  const right = h('div', { class: 'panel' },
    h('h3', {}, '合成修形场(法向 μm)'),
    heat.canvas,
    h('h3', { style: 'margin-top:12px' }, '三维齿面(偏差着色)'),
    view3d.host,
  );

  function params(): ModificationParams {
    return which === 'pinion' ? plan.pinion[side] : plan.gear[side];
  }

  function paramForm(): HTMLElement {
    const m = params();
    const box = h('fieldset', { class: 'gear-form' },
      h('legend', {}, `${which === 'pinion' ? '小轮' : '大轮'} · ${side === 'working' ? '工作面' : '非工作面'}`));
    const row = (label: string, key: keyof ModificationParams, step: number, unit: string): void => {
      const val = m[key] as number;
      box.append(labeledField(label, numInput(val, step, (v) => {
        (m[key] as number) = v;
        void refresh();
      }), unit));
    };
    row('齿向鼓形 Cβ', 'leadCrown', 1, 'μm');
    row('齿端修薄 Ce', 'endRelief', 1, 'μm');
    row('齿端修薄长度 Le', 'endReliefLength', 1, 'mm');
    row('齿顶修缘 Ca', 'tipRelief', 1, 'μm');
    row('修缘深度 La', 'tipReliefDepth', 0.5, 'mm');
    row('螺旋角修正', 'helixCorrection', 1, 'μm');
    box.append(
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => { side = side === 'working' ? 'nonworking' : 'working'; setSide(side); void refresh(); } }, '切换工作/非工作面'),
        h('button', { class: 'btn', onclick: () => { which = which === 'pinion' ? 'gear' : 'pinion'; void refresh(); } }, '切换小轮/大轮'),
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, '红丹层厚'),
        numInput(plan.redLeadThickness, 1, (v) => { plan.redLeadThickness = v; void refresh(); }), 'μm'),
    );
    return box;
  }

  function buildCombinedField(): { field: Float64Array; nR: number; nZ: number } {
    const m = params();
    const nR = m.topoNR;
    const nZ = m.topoNZ;
    const depth = d1.ra - Math.max(d1.rb, d1.rf);
    const faceW = which === 'pinion' ? derived.pinionV.faceWidth : derived.gearV.faceWidth;
    const field = new Float64Array(nR * nZ);
    for (let i = 0; i < nR; i++) {
      const rho = i / (nR - 1);
      for (let j = 0; j < nZ; j++) {
        const zeta = -1 + (2 * j) / (nZ - 1);
        // 解析修形 (mm -> μm)
        let val = modificationAt({ ...m, topology: null }, zeta, rho, faceW, depth) / 1e-3;
        if (m.topology) val += m.topology[i * nZ + j];
        field[i * nZ + j] = val;
      }
    }
    return { field, nR, nZ };
  }

  function drawTopo(): void {
    const ctx = topoCanvas.getContext('2d')!;
    const W = 480;
    const H = 300;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#141820';
    ctx.fillRect(0, 0, W, H);
    const m = params();
    if (!m.topology) m.topology = emptyTopology(m.topoNR, m.topoNZ);
    const nR = m.topoNR;
    const nZ = m.topoNZ;
    const cw = W / nZ;
    const ch = H / nR;
    let mx = -Infinity;
    for (const v of m.topology) mx = Math.max(mx, Math.abs(v));
    const scale = Math.max(mx, 10);
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nZ; j++) {
        const v = m.topology[i * nZ + j];
        const t = Math.abs(v) / scale;
        ctx.fillStyle = v >= 0
          ? `rgb(${Math.round(40 + 200 * t)},${Math.round(70 + 60 * (1 - t))},${Math.round(90 + 40 * (1 - t))})`
          : `rgb(${Math.round(60 + 40 * (1 - t))},${Math.round(100 + 120 * t)},${Math.round(180 + 60 * t)})`;
        ctx.fillRect(j * cw, i * ch, cw + 0.5, ch + 0.5);
      }
    }
    ctx.strokeStyle = '#3a4150';
    ctx.strokeRect(0, 0, W, H);
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '11px system-ui';
    ctx.fillText('齿顶 → 齿根 (纵向)', 8, H - 8);
    ctx.fillText('齿宽方向 (横向)', W - 110, H - 8);
  }

  function paintAt(evt: MouseEvent): void {
    const rect = topoCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const m = params();
    if (!m.topology) m.topology = emptyTopology(m.topoNR, m.topoNZ);
    const j = Math.min(m.topoNZ - 1, Math.max(0, Math.floor((x / rect.width) * m.topoNZ)));
    const i = Math.min(m.topoNR - 1, Math.max(0, Math.floor((y / rect.height) * m.topoNR)));
    const brush = parseFloat((left.querySelector('[data-role="brush"]') as HTMLInputElement)?.value ?? '5');
    m.topology[i * m.topoNZ + j] = evt.buttons === 2 ? 0 : brush;
    drawTopo();
  }
  topoCanvas.addEventListener('mousedown', paintAt);
  topoCanvas.addEventListener('mousemove', (e) => { if (e.buttons === 1) paintAt(e); });
  topoCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let timer: ReturnType<typeof setTimeout> | null = null;
  async function refresh(): Promise<void> {
    left.querySelector('fieldset')?.replaceWith(paramForm());
    drawTopo();
    const { field, nR, nZ } = buildCombinedField();
    const sAxis = Float64Array.from({ length: nR }, (_, i) => i);
    const zAxis = Float64Array.from({ length: nZ }, (_, j) => j);
    heat.render(field, nR, nZ, sAxis, zAxis, {
      title: '合成修形量 (μm)',
      mode: 'stress',
      xLabel: '齿宽格点',
      yLabel: '齿高格点',
    });
    const g = which === 'pinion' ? pair.pinion : pair.gear;
    view3d.showGear(g, params());
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await savePlan(plan);
      toast('修形方案已保存', 'ok');
    }, 400);
  }

  const planBar = h('div', { class: 'toolbar' },
    h('select', {
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        const found = getState().plans.find((p) => p.id === id);
        if (found) { plan = found; void refresh(); }
      },
    }, ...state.plans.filter((p) => p.pairId === pair.id).map((p) => new Option(p.name, p.id, p.id === plan.id, p.id === plan.id))),
    h('button', {
      class: 'btn',
      onclick: () => {
        plan = defaultPlan(pair.id, uid('plan'));
        plan.name = '修形方案 ' + (state.plans.filter((p) => p.pairId === pair.id).length + 1);
        void savePlan(plan).then(() => { toast('已新建方案', 'ok'); void refresh(); });
      },
    }, '新建方案'),
  );

  left.append(planBar, paramForm());
  root.append(left, center, right);
  void refresh();
  return root;
}

export function ensurePlan(pairId: string): ModificationPlan {
  const state = getState();
  return state.plans.find((p) => p.pairId === pairId) ?? defaultPlan(pairId, uid('plan'));
}
