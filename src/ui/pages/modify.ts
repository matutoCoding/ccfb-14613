/**
 * 页面 2:齿面修形 —— 修形方案编辑(鼓形/齿端修薄/齿顶修缘/螺旋角修正/拓扑网格),
 * 修形曲线预览 + 三维齿面 μm 级放大查看。
 */
import { el, fieldRow, fmt } from '../dom';
import { db, uid } from '../../db/db';
import type { GearPairParams, ModificationSpec } from '../../core/types';
import { getSelection, setSelection } from '../state';
import { ToothViewer } from '../viewer3d';
import { leadModification, endRelief, profileModification } from '../../core/modification';

const TOPO_N = 9; // 拓扑网格 9×9

function defaultMod(pairId: string, target: 'pinion' | 'gear'): ModificationSpec {
  return {
    id: uid(), name: `${target === 'pinion' ? '小轮' : '大轮'}修形`, pairId, target,
    crowning: 12, endReliefAmount: 8, endReliefLength: 6,
    tipReliefAmount: 10, tipReliefStart: 0.75, profileCrowning: 0, helixCorrection: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export async function renderModifyPage(root: HTMLElement): Promise<void> {
  const pairs = await db.pairs.list();
  const sel = getSelection();
  const pair: GearPairParams | undefined = pairs.find((p) => p.id === sel.pairId) ?? pairs[0];
  if (!pair) {
    root.append(el('div', { class: 'panel' }, ['请先在「齿轮副」页创建并保存一个齿轮副。']));
    return;
  }
  setSelection({ pairId: pair.id });
  const mods = await db.mods.listFor(pair.id);
  let current: ModificationSpec =
    mods.find((m) => m.id === sel.modPinionId) ?? mods[0] ?? defaultMod(pair.id, 'pinion');

  // --- 方案选择 ---
  const selPanel = el('div', { class: 'panel' });
  const modSel = el('select', { class: 'sel' });
  const rebuildSel = (): void => {
    modSel.innerHTML = '';
    for (const m of mods) modSel.append(el('option', { value: m.id }, [`${m.name}(${m.target === 'pinion' ? '小轮' : '大轮'})`]));
    modSel.value = current.id;
  };
  rebuildSel();
  modSel.onchange = async () => {
    const m = await db.mods.get(modSel.value);
    if (m) { current = m; fill(); }
  };
  const newBtn = el('button', {}, ['新建小轮方案']);
  newBtn.onclick = () => { current = defaultMod(pair.id, 'pinion'); fill(); };
  const newGBtn = el('button', {}, ['新建大轮方案']);
  newGBtn.onclick = () => { current = defaultMod(pair.id, 'gear'); fill(); };
  selPanel.append(el('div', { class: 'toolbar' }, [el('span', {}, [`当前齿轮副:${pair.name}　方案:`]), modSel, newBtn, newGBtn]));

  // --- 修形参数表单 ---
  const formPanel = el('div', { class: 'panel' });
  formPanel.append(el('h2', {}, ['修形量(μm)']));
  const defs: [keyof ModificationSpec, string, string?][] = [
    ['crowning', '齿向鼓形量', 'μm'],
    ['endReliefAmount', '齿端修薄量', 'μm'],
    ['endReliefLength', '齿端修薄长度(每端)', 'mm'],
    ['tipReliefAmount', '齿顶修缘量', 'μm'],
    ['tipReliefStart', '修缘起点(0齿根~1齿顶)'],
    ['profileCrowning', '齿形鼓形量', 'μm'],
    ['helixCorrection', '螺旋角修正(全齿宽)', 'μm'],
  ];
  const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const formCols = el('div', { class: 'cols' });
  const colA = el('div', { class: 'grow' });
  for (const [key, label, unit] of defs) {
    const { row, input } = fieldRow({ key, label, unit }, current[key] as number);
    inputs[key] = input;
    colA.append(row);
  }
  const targetSel = el('select', { class: 'sel' }, [
    el('option', { value: 'pinion' }, ['小轮']), el('option', { value: 'gear' }, ['大轮']),
  ]);
  targetSel.value = current.target;
  colA.append(el('div', { class: 'field-row' }, [el('label', {}, ['修形对象']), targetSel]));
  formCols.append(colA);
  formPanel.append(formCols);

  // --- 拓扑网格编辑器 ---
  const topoPanel = el('div', { class: 'panel' });
  topoPanel.append(el('h2', {}, [`自由拓扑修形(${TOPO_N}×${TOPO_N},μm,行=齿向,列=齿廓)`]));
  const topoWrap = el('div', { class: 'topo-grid' });
  const topoInputs: HTMLInputElement[][] = [];
  const buildTopo = (): void => {
    topoWrap.innerHTML = '';
    topoInputs.length = 0;
    const grid = current.topology ?? Array.from({ length: TOPO_N }, () => new Array(TOPO_N).fill(0));
    for (let i = 0; i < TOPO_N; i++) {
      const rowEl = el('div', {});
      const rowIn: HTMLInputElement[] = [];
      for (let j = 0; j < TOPO_N; j++) {
        const inp = el('input', { type: 'number', step: 'any', value: String(grid[i]?.[j] ?? 0) });
        inp.oninput = () => { readForm(); refreshViews(); };
        rowIn.push(inp);
        rowEl.append(inp);
      }
      topoInputs.push(rowIn);
      topoWrap.append(rowEl);
    }
  };
  const topoEnable = el('input', { type: 'checkbox' });
  topoEnable.checked = !!current.topology;
  topoEnable.onchange = () => { readForm(); refreshViews(); };
  topoPanel.append(el('div', { class: 'field-row' }, [el('label', {}, ['启用拓扑修形']), topoEnable]));
  topoPanel.append(topoWrap);
  buildTopo();

  // --- 修形曲线预览 ---
  const curvePanel = el('div', { class: 'panel' });
  curvePanel.append(el('h2', {}, ['修形曲线']));
  const curveCanvas = el('canvas', { class: 'plot', width: '640', height: '240' });
  curvePanel.append(curveCanvas);

  // --- 三维查看 ---
  const viewPanel = el('div', { class: 'panel' });
  viewPanel.append(el('h2', {}, ['三维齿面(修形放大显示)']));
  const exaggIn = el('input', { type: 'range', min: '0', max: '5000', value: '1000', step: '100' });
  const exaggLabel = el('span', {}, ['放大 ×1000']);
  exaggIn.oninput = () => {
    exaggLabel.textContent = `放大 ×${exaggIn.value}`;
    refreshViews();
  };
  const viewerBox = el('div', { class: 'viewer-box' });
  viewPanel.append(el('div', { class: 'toolbar' }, [el('span', {}, ['修形放大倍数:']), exaggIn, exaggLabel]));
  viewPanel.append(viewerBox);
  const viewer = new ToothViewer(viewerBox);

  const readForm = (): void => {
    current = {
      ...current,
      crowning: parseFloat(inputs.crowning.value) || 0,
      endReliefAmount: parseFloat(inputs.endReliefAmount.value) || 0,
      endReliefLength: parseFloat(inputs.endReliefLength.value) || 0,
      tipReliefAmount: parseFloat(inputs.tipReliefAmount.value) || 0,
      tipReliefStart: Math.min(0.99, Math.max(0, parseFloat(inputs.tipReliefStart.value) || 0)),
      profileCrowning: parseFloat(inputs.profileCrowning.value) || 0,
      helixCorrection: parseFloat(inputs.helixCorrection.value) || 0,
      target: targetSel.value === 'gear' ? 'gear' : 'pinion',
      topology: topoEnable.checked ? topoInputs.map((r) => r.map((i) => parseFloat(i.value) || 0)) : undefined,
      updatedAt: Date.now(),
    };
  };

  const drawCurves = (): void => {
    const ctx = curveCanvas.getContext('2d')!;
    const W = curveCanvas.width, H = curveCanvas.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const B = (current.target === 'pinion' ? pair.pinion : pair.gear).faceWidth;
    let maxV = 1;
    const leadVals: number[] = [], profVals: number[] = [];
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      leadVals.push(leadModification(current, t) + endRelief(current, t, B));
      profVals.push(profileModification(current, t));
    }
    for (const v of [...leadVals, ...profVals]) maxV = Math.max(maxV, Math.abs(v));
    const plot = (vals: number[], color: string, label: string, ly: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      vals.forEach((v, k) => {
        const x = (k / (vals.length - 1)) * W;
        const y = H - 20 - (v / maxV) * (H - 50);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, W - 150, ly);
    };
    ctx.strokeStyle = '#ccc';
    ctx.beginPath(); ctx.moveTo(0, H - 20); ctx.lineTo(W, H - 20); ctx.stroke();
    plot(leadVals, '#1a5fb4', '齿向修形 (μm)', 16);
    plot(profVals, '#c01c28', '齿廓修形 (μm)', 32);
    ctx.fillStyle = '#333';
    ctx.fillText(`峰值 ${fmt(maxV, 1)} μm`, 8, 16);
  };

  const refreshViews = (): void => {
    drawCurves();
    viewer.showTooth(
      current.target === 'pinion' ? pair.pinion : pair.gear,
      current,
      { exaggeration: parseFloat(exaggIn.value) || 0 },
    );
  };

  const fill = (): void => {
    for (const [key] of defs) {
      const inp = inputs[key];
      if (inp) inp.value = String(current[key as keyof ModificationSpec] ?? 0);
    }
    targetSel.value = current.target;
    topoEnable.checked = !!current.topology;
    buildTopo();
    refreshViews();
  };

  const saveBtn = el('button', { class: 'primary' }, ['保存方案']);
  saveBtn.onclick = async () => {
    readForm();
    await db.mods.put(current);
    if (!mods.find((m) => m.id === current.id)) mods.push(current);
    rebuildSel();
    if (current.target === 'pinion') setSelection({ modPinionId: current.id });
    else setSelection({ modGearId: current.id });
    saveBtn.textContent = '已保存 ✓';
    setTimeout(() => { saveBtn.textContent = '保存方案'; }, 1200);
  };
  const delBtn = el('button', { class: 'danger' }, ['删除方案']);
  delBtn.onclick = async () => {
    await db.mods.delete(current.id);
    location.reload();
  };
  for (const inp of Object.values(inputs)) {
    if (inp instanceof HTMLInputElement) inp.oninput = () => { readForm(); refreshViews(); };
  }
  targetSel.onchange = () => { readForm(); refreshViews(); };
  formPanel.append(el('div', { class: 'toolbar' }, [saveBtn, delBtn]));

  root.append(selPanel, el('div', { class: 'cols' }, [
    el('div', { class: 'grow' }, [formPanel, topoPanel, curvePanel]),
    el('div', { class: 'grow' }, [viewPanel]),
  ]));
  fill();
}
