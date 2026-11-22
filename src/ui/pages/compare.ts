/**
 * 页面 5:斑点对比 —— 现场照片导入、齿面坐标对齐、仿真/实测叠加、
 * 装配误差反推、国标接触精度等级判定。
 */
import { el, fmt } from '../dom';
import { db } from '../../db/db';
import { DEFAULT_SIM_SETTINGS, type SimSettings } from '../../core/types';
import { getSelection } from '../state';
import { runSimulation, buildTcaInput } from '../../core/simulate';
import { invertErrors } from '../../core/invert';
import { judgeGrade, DEFAULT_GRADE_TABLE } from '../../core/standards';
import { paintPattern } from '../patternCanvas';

export async function renderComparePage(root: HTMLElement): Promise<void> {
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
  const settings: SimSettings = { ...DEFAULT_SIM_SETTINGS };

  // --- 照片导入 ---
  const photoPanel = el('div', { class: 'panel' });
  photoPanel.append(el('h2', {}, ['现场斑点照片导入与对齐']));
  const fileIn = el('input', { type: 'file', accept: 'image/*' });
  const photoCanvas = el('canvas', { class: 'plot', width: '480', height: '240' });
  photoPanel.append(el('div', { class: 'toolbar' }, [fileIn]), photoCanvas);

  // 对齐参数:平移/缩放(相对齿面矩形)
  const align = { ox: 0, oy: 0, sx: 1, sy: 1, threshold: 40 };
  const alignPanel = el('div', { class: 'panel' });
  alignPanel.append(el('h2', {}, ['对齐调整(把照片斑点框到齿面坐标)']));
  const mkSlider = (label: string, min: number, max: number, val: number, set: (v: number) => void): void => {
    const inp = el('input', { type: 'range', min: String(min), max: String(max), value: String(val), step: '1' });
    const lab = el('span', {}, [String(val)]);
    inp.oninput = () => { set(parseFloat(inp.value)); lab.textContent = inp.value; refreshOverlay(); };
    alignPanel.append(el('div', { class: 'field-row' }, [el('label', {}, [label]), inp, lab]));
  };

  // --- 叠加显示 ---
  const overlayPanel = el('div', { class: 'panel' });
  overlayPanel.append(el('h2', {}, ['仿真斑点 vs 实测斑点']));
  const overlayCanvas = el('canvas', { class: 'plot', width: '720', height: '300' });
  overlayPanel.append(overlayCanvas, el('div', { class: 'note' }, ['蓝色轮廓=实测照片提取的斑点边界;底色=仿真斑点。']));

  // --- 反推 ---
  const invertPanel = el('div', { class: 'panel' });
  invertPanel.append(el('h2', {}, ['装配误差反推']));
  const invertBtn = el('button', { class: 'primary' }, ['反推装配误差']);
  const invertOut = el('div', {});
  invertPanel.append(el('div', { class: 'toolbar' }, [invertBtn]), invertOut);

  // --- 国标判定 ---
  const gradePanel = el('div', { class: 'panel' });
  gradePanel.append(el('h2', {}, ['接触精度等级判定(GB/T 10095 接触斑点)']));
  const gradeSel = el('select', { class: 'sel' });
  for (const r of DEFAULT_GRADE_TABLE) gradeSel.append(el('option', { value: String(r.grade) }, [`${r.grade} 级(高≥${r.heightPct}% 长≥${r.lengthPct}%)`]));
  gradeSel.value = '7';
  const gradeOut = el('div', {});
  gradePanel.append(el('div', { class: 'toolbar' }, [el('span', {}, ['目标等级:']), gradeSel]), gradeOut);

  let img: HTMLImageElement | null = null;
  let measuredMask: Uint8Array | null = null;
  let simMask: Uint8Array | null = null;
  let simGap: Float32Array | null = null;
  let nF = settings.faceSections, nP = settings.profileSamples;

  const drawPhoto = (): void => {
    const ctx = photoCanvas.getContext('2d')!;
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
    if (!img) return;
    ctx.drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);
    // 对齐框
    const { ox, oy, sx, sy } = align;
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    const w = photoCanvas.width * sx, h = photoCanvas.height * sy;
    ctx.strokeRect(ox, oy, w, h);
  };

  /** 从照片提取红丹斑点掩膜(红色主导像素) */
  const extractMask = (): void => {
    if (!img) return;
    const off = document.createElement('canvas');
    off.width = nF; off.height = nP;
    const ctx = off.getContext('2d')!;
    // 按对齐框裁剪绘制:齿面矩形 → 网格
    const sxr = photoCanvas.width * align.sx, syr = photoCanvas.height * align.sy;
    ctx.drawImage(
      photoCanvas,
      align.ox, align.oy, sxr, syr,
      0, 0, nF, nP,
    );
    const data = ctx.getImageData(0, 0, nF, nP).data;
    measuredMask = new Uint8Array(nF * nP);
    for (let i = 0; i < nF; i++) {
      for (let j = 0; j < nP; j++) {
        // 图像行向下,齿面 j 向上(齿顶在上)
        const pix = (j * nF + i) * 4;
        const r = data[pix], g = data[pix + 1], b = data[pix + 2];
        // 红丹被蹭掉处偏亮偏灰;残红处 r 显著大于 g/b。接触区=亮金属色
        const bright = (r + g + b) / 3;
        const redDom = r - (g + b) / 2;
        measuredMask[i * nP + (nP - 1 - j)] = bright > 200 - align.threshold || redDom < align.threshold * 0.4 && bright > 140 ? 1 : 0;
      }
    }
  };

  const refreshOverlay = (): void => {
    drawPhoto();
    extractMask();
    if (simMask && simGap) {
      paintPattern(overlayCanvas, simMask, {
        nFace: nF, nProfile: nP, gap: simGap,
        paintThickness: settings.paintThickness,
        measuredMask: measuredMask ?? undefined,
        title: '仿真+实测',
      });
    }
    updateGrade();
  };

  const updateGrade = (): void => {
    if (!simMask) return;
    // 用实测掩膜(有照片时)或仿真掩膜计算百分比
    const mask = measuredMask ?? simMask;
    const colMarked = new Array<boolean>(nF).fill(false);
    const rowMarked = new Array<boolean>(nP).fill(false);
    for (let i = 0; i < nF; i++)
      for (let j = 0; j < nP; j++)
        if (mask[i * nP + j]) { colMarked[i] = true; rowMarked[j] = true; }
    const extent = (arr: boolean[]): number => {
      let lo = -1, hi = -1;
      arr.forEach((v, idx) => { if (v) { if (lo < 0) lo = idx; hi = idx; } });
      return lo < 0 ? 0 : ((hi - lo) / (arr.length - 1)) * 100;
    };
    const hPct = extent(rowMarked), lPct = extent(colMarked);
    const j = judgeGrade(hPct, lPct, parseInt(gradeSel.value));
    gradeOut.innerHTML = '';
    gradeOut.append(el('div', {}, [
      `斑点:长度 ${fmt(lPct, 1)}% / 高度 ${fmt(hPct, 1)}% → `,
    ]));
    gradeOut.append(el('span', { class: `badge ${j.pass ? 'ok' : 'bad'}` }, [
      j.pass ? `合格(达到 ${j.grade} 级)` : `不合格(要求 ${gradeSel.value} 级:高≥${j.requiredHeightPct}% 长≥${j.requiredLengthPct}%)`,
    ]));
  };
  gradeSel.onchange = updateGrade;

  mkSlider('水平偏移', -200, 200, 0, (v) => { align.ox = v; });
  mkSlider('垂直偏移', -120, 120, 0, (v) => { align.oy = v; });
  mkSlider('水平缩放 %', 50, 150, 100, (v) => { align.sx = v / 100; });
  mkSlider('垂直缩放 %', 50, 150, 100, (v) => { align.sy = v / 100; });
  mkSlider('提取阈值', 10, 100, 40, (v) => { align.threshold = v; });

  fileIn.onchange = () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { img = im; refreshOverlay(); URL.revokeObjectURL(url); };
    im.src = url;
  };

  // 先跑一次仿真拿基准斑点
  const runBtn = el('button', { class: 'primary' }, ['生成仿真斑点']);
  const runStatus = el('span', { class: 'badge' }, ['']);
  runBtn.onclick = async () => {
    runBtn.disabled = true;
    const sim = await runSimulation(pair, modP, modG, asm, settings, false);
    simMask = sim.result.mask;
    simGap = sim.result.gap;
    nF = sim.result.nFace; nP = sim.result.nProfile;
    runStatus.textContent = `已生成(${sim.backend})`;
    runBtn.disabled = false;
    refreshOverlay();
  };
  overlayPanel.insertBefore(el('div', { class: 'toolbar' }, [runBtn, runStatus]), overlayCanvas);

  invertBtn.onclick = async () => {
    if (!measuredMask) { invertOut.textContent = '请先导入照片并对齐。'; return; }
    invertBtn.disabled = true;
    invertOut.textContent = '反推中…';
    await new Promise((r) => setTimeout(r, 30));
    // 反推工厂:误差 → 完整 TCA 输入(中心距偏差会移动接触窗口)
    const factory = (e: { dCenterUm: number; slopeParUm: number; slopeSkewUm: number }) =>
      buildTcaInput(pair, modP, modG, {
        id: '', name: '', pairId: pair.id,
        centerDistance: e.dCenterUm, parallelism: e.slopeParUm, skew: e.slopeSkewUm,
        housingParallelism: 0, housingSkew: 0, mountingPinion: 0, mountingGear: 0,
        createdAt: 0, updatedAt: 0,
      }, settings);
    const res = invertErrors(factory, measuredMask);
    invertOut.innerHTML = '';
    const t = el('table', { class: 'data' });
    t.append(el('tr', {}, [el('th', {}, ['误差项']), el('th', {}, ['反推值'])]));
    for (const [k, v] of [
      ['中心距偏差 Δa', fmt(res.errors.dCenterUm, 1) + ' μm'],
      ['平行度 fx', fmt(res.errors.slopeParUm, 1) + ' μm/全齿宽'],
      ['交错度 fy', fmt(res.errors.slopeSkewUm, 1) + ' μm/全齿宽'],
      ['掩膜不一致率', fmt(res.residual * 100, 1) + ' %'],
    ] as [string, string][]) {
      t.append(el('tr', {}, [el('td', {}, [k]), el('td', {}, [v])]));
    }
    invertOut.append(t);
    invertBtn.disabled = false;
  };

  root.append(el('div', { class: 'cols' }, [
    el('div', { class: 'grow' }, [photoPanel, alignPanel, invertPanel]),
    el('div', { class: 'grow' }, [overlayPanel, gradePanel]),
  ]));
}
