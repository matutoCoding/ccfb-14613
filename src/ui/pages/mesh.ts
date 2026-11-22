/**
 * 页面 4:啮合仿真 —— 间隙场(GPU)、斑点、传动误差、加载接触。
 * 支持修形前后 TE 对比、轻载/满载斑点、工作面/非工作面切换。
 */
import { el, fmt } from '../dom';
import { db } from '../../db/db';
import type { SimSettings } from '../../core/types';
import { DEFAULT_SIM_SETTINGS } from '../../core/types';
import { getSelection } from '../state';
import { runSimulation, type SimResult } from '../../core/simulate';
import { teStats } from '../../core/tca';
import { paintPattern, paintTeCurve } from '../patternCanvas';

export async function renderMeshPage(root: HTMLElement): Promise<void> {
  const pairs = await db.pairs.list();
  const sel = getSelection();
  const pair = pairs.find((p) => p.id === sel.pairId) ?? pairs[0];
  if (!pair) {
    root.append(el('div', { class: 'panel' }, ['请先在「齿轮副」页创建并保存一个齿轮副。']));
    return;
  }
  const mods = await db.mods.listFor(pair.id);
  const asms = await db.assemblies.listFor(pair.id);
  const modP = mods.find((m) => m.target === 'pinion') ?? null;
  const modG = mods.find((m) => m.target === 'gear') ?? null;
  const asm = asms[0] ?? null;

  // --- 仿真设置 ---
  const setPanel = el('div', { class: 'panel' });
  setPanel.append(el('h2', {}, ['仿真设置']));
  const settings: SimSettings = { ...DEFAULT_SIM_SETTINGS };
  const mkNum = (label: string, key: keyof SimSettings): HTMLInputElement => {
    const inp = el('input', { type: 'number', step: 'any', value: String(settings[key]) });
    inp.oninput = () => { (settings[key] as number) = parseFloat(inp.value) || 0; };
    setPanel.append(el('div', { class: 'field-row' }, [el('label', {}, [label]), inp]));
    return inp;
  };
  mkNum('红丹层厚 (μm)', 'paintThickness');
  mkNum('载荷扭矩 (N·m)', 'torque');
  mkNum('齿向截面数', 'faceSections');
  mkNum('齿廓采样数', 'profileSamples');
  mkNum('每转步数', 'rotationSteps');

  const infoLine = el('div', { class: 'note' }, [
    `修形方案:小轮 ${modP?.name ?? '无'} / 大轮 ${modG?.name ?? '无'};装配记录:${asm?.name ?? '无(零误差)'}`,
  ]);
  setPanel.append(infoLine);

  const runBtn = el('button', { class: 'primary' }, ['运行仿真']);
  const status = el('span', { class: 'badge' }, ['未运行']);
  setPanel.append(el('div', { class: 'toolbar' }, [runBtn, status]));

  // --- 结果区 ---
  const statsPanel = el('div', { class: 'panel' });
  const patternPanel = el('div', { class: 'panel' });
  patternPanel.append(el('h2', {}, ['接触斑点']));
  const flankSel = el('select', { class: 'sel' }, [
    el('option', { value: 'work' }, ['工作面']),
    el('option', { value: 'back' }, ['非工作面']),
  ]);
  const loadSel = el('select', { class: 'sel' }, [
    el('option', { value: 'light' }, ['轻载(红丹)']),
    el('option', { value: 'full' }, ['满载']),
  ]);
  const patternCanvas = el('canvas', { class: 'plot', width: '720', height: '300' });
  patternPanel.append(
    el('div', { class: 'toolbar' }, [flankSel, loadSel]),
    patternCanvas,
    el('div', { class: 'note' }, ['亮色=红丹被蹭掉(接触区),红色描边=残红;满载时红框=齿端应力集中。']),
  );

  const tePanel = el('div', { class: 'panel' });
  tePanel.append(el('h2', {}, ['传动误差(修形前后对比)']));
  const teCanvas = el('canvas', { class: 'plot', width: '720', height: '240' });
  tePanel.append(teCanvas);

  const loadPanel = el('div', { class: 'panel' });
  loadPanel.append(el('h2', {}, ['载荷分布(沿齿宽)']));
  const loadCanvas = el('canvas', { class: 'plot', width: '720', height: '200' });
  loadPanel.append(loadCanvas);

  let simMod: SimResult | null = null;   // 带修形
  let simZero: SimResult | null = null;  // 零修形(对比基准)

  const renderStats = (): void => {
    if (!simMod) return;
    const r = simMod.result;
    const te = teStats(r.transmissionError);
    const te0 = simZero ? teStats(simZero.result.transmissionError) : null;
    const ld = r.loaded;
    statsPanel.innerHTML = '<h2>结果汇总</h2>';
    const grid = el('div', { class: 'stat-grid' });
    const stat = (k: string, v: string): HTMLElement =>
      el('div', { class: 'stat' }, [el('div', { class: 'v' }, [v]), el('div', { class: 'k' }, [k])]);
    grid.append(
      stat('斑点长度(齿宽)', fmt(r.patternLengthPct, 1) + ' %'),
      stat('斑点高度(齿高)', fmt(r.patternHeightPct, 1) + ' %'),
      stat('TE 峰峰值(修形后)', fmt(te.peakToPeak, 2) + ' μm'),
      stat('TE 峰峰值(零修形)', te0 ? fmt(te0.peakToPeak, 2) + ' μm' : '—'),
      stat('啮合频率幅值', fmt(te.meshAmplitude, 2) + ' μm'),
      stat('最大接触应力', ld ? fmt(ld.maxStress, 0) + ' MPa' : '—'),
      stat('应力集中位置(齿向)', ld ? fmt(ld.maxStressPos * 100, 0) + ' %' : '—'),
    );
    statsPanel.append(grid);
  };

  const renderPattern = (): void => {
    if (!simMod) return;
    const r = simMod.result;
    const full = loadSel.value === 'full';
    let mask = full && r.loaded ? r.loaded.maskFullLoad : r.mask;
    let gap = r.gap;
    // 非工作面:交错/螺旋角修正反号 + 侧隙抬高
    if (flankSel.value === 'back') {
      const tca = simMod.tca;
      const backTca = {
        ...tca,
        errors: { ...tca.errors, slopeSkewUm: -tca.errors.slopeSkewUm },
      };
      // 用 CPU 快速重算背隙面(网格小,开销可忽略)
      const { computeGapField, analyzeGapField } = tcaModule;
      const gf = computeGapField(backTca);
      const backRes = analyzeGapField(backTca, gf);
      mask = backRes.mask;
      gap = gf.gap;
    }
    paintPattern(patternCanvas, mask, {
      nFace: r.nFace, nProfile: r.nProfile,
      gap,
      paintThickness: settings.paintThickness,
      edgeFlags: full ? r.loaded?.edgeStressFlags : undefined,
      title: full ? '满载' : '轻载',
    });
  };

  const renderTe = (): void => {
    if (!simMod) return;
    const curves = [{ data: simMod.result.transmissionError, color: '#c01c28', label: '修形后' }];
    if (simZero) curves.push({ data: simZero.result.transmissionError, color: '#1a5fb4', label: '零修形' });
    paintTeCurve(teCanvas, curves);
  };

  const renderLoad = (): void => {
    const ld = simMod?.result.loaded;
    if (!ld) return;
    const ctx = loadCanvas.getContext('2d')!;
    const W = loadCanvas.width, H = loadCanvas.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    let max = 1;
    for (const v of ld.loadPerLength) max = Math.max(max, v);
    const n = ld.loadPerLength.length;
    ctx.strokeStyle = '#1a5fb4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H - 20 - (ld.loadPerLength[i] / max) * (H - 40);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText(`单位长度载荷 (N/mm),峰值 ${fmt(max, 1)}`, 8, 14);
    // 应力集中标记
    ctx.fillStyle = 'rgba(255,0,0,0.25)';
    for (let i = 0; i < n; i++) {
      if (ld.edgeStressFlags[i]) ctx.fillRect((i / (n - 1)) * W - 2, 0, 4, H);
    }
  };

  runBtn.onclick = async () => {
    runBtn.disabled = true;
    status.textContent = '计算中…';
    try {
      simMod = await runSimulation(pair, modP, modG, asm, settings, true);
      simZero = await runSimulation(pair, null, null, asm, settings, false);
      status.textContent = `完成(${simMod.backend === 'webgpu' ? 'WebGPU' : 'CPU 回退'})`;
      renderStats();
      renderPattern();
      renderTe();
      renderLoad();
    } catch (e) {
      status.textContent = '出错:' + String(e);
    } finally {
      runBtn.disabled = false;
    }
  };
  flankSel.onchange = renderPattern;
  loadSel.onchange = renderPattern;

  root.append(el('div', { class: 'cols' }, [
    el('div', {}, [setPanel]),
    el('div', { class: 'grow' }, [statsPanel, patternPanel, tePanel, loadPanel]),
  ]));
}

// 延迟引入避免循环依赖问题(tca 为纯函数模块)
import * as tcaModule from '../../core/tca';
