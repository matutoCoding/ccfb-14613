/**
 * 装配误差页面
 * 圆柱: 中心距偏差 + 轴线平行度两分量; 锥齿轮: 安装距 + 轴交角
 * 箱体载荷: 扭矩/刚度 -> 附加偏斜实时显示
 */
import type { AssemblyError, GearPair } from '../../gear/types';
import { uid } from '../../gear/types';
import { getState, saveAssembly } from '../../db/store';
import { derivePair } from '../../gear/pair';
import { effectiveErrors } from '../../gear/assembly';
import { rad2deg, deg2rad } from '../../gear/math3d';
import { h, labeledField, numInput, toast } from '../dom';

function blankAssembly(pairId: string): AssemblyError {
  return {
    id: uid('asm'),
    name: '装配误差 ' + new Date().toLocaleString('zh-CN'),
    updatedAt: Date.now(),
    pairId,
    centerDistanceError: 0,
    parallelismInPlane: 0,
    parallelismCross: 0,
    pinionMountingError: 0,
    gearMountingError: 0,
    shaftAngleError: 0,
    housingTorque: 500,
    housingStiffness: 2e6,
  };
}

export function assemblyPage(): HTMLElement {
  const state = getState();
  const pairMaybe = state.pairs.find((p) => p.id === state.currentPairId);
  const root = h('div', { class: 'page' });
  if (!pairMaybe) return h('div', { class: 'empty' }, '请先创建齿轮副');
  const pair: GearPair = pairMaybe;

  let asm =
    state.assemblies.find((a) => a.id === state.currentAssemblyId && a.pairId === pair.id) ??
    state.assemblies.find((a) => a.pairId === pair.id) ??
    blankAssembly(pair.id);
  const derived = derivePair(pair);
  const isBevel = derived.isBevel;

  const effBox = h('div', { class: 'eff-box' });
  const form = h('div', { class: 'panel' });

  function drawEff(): void {
    const eff = effectiveErrors(pair, derived, asm);
    const housing = asm.housingStiffness > 0 && Number.isFinite(asm.housingStiffness)
      ? (asm.housingTorque / asm.housingStiffness) * 1e6
      : 0;
    effBox.replaceChildren(
      h('h3', {}, 'TCA 等效误差 (实时)'),
      h('div', { class: 'kv' },
        h('span', {}, '等效中心距偏差 Δa'), h('strong', {}, (eff.centerDistance * 1000).toFixed(2) + ' μm'),
        h('span', {}, '面内偏斜 fΣβ'), h('strong', {}, rad2deg(eff.tiltInPlane).toFixed(4) + '°'),
        h('span', {}, '交错偏斜 fΣδ'), h('strong', {}, rad2deg(eff.tiltCross).toFixed(4) + '°'),
        h('span', {}, '箱体附加偏斜'), h('strong', {}, housing.toFixed(2) + ' μrad'),
      ),
      h('p', { class: 'hint' },
        isBevel
          ? '锥齿轮: 安装距沿节锥法向投影为等效中心距, 轴交角偏差对应面内偏斜 (Tredgold 一阶映射)'
          : '圆柱齿轮: 误差按 ISO 1328 轴线平行度两分量输入, 线性化投影到作用线法向'),
    );
  }

  function bind(label: string, get: () => number, set: (v: number) => void, step: number, unit: string, conv: (v: number) => number = (v) => v): void {
    form.append(labeledField(label, numInput(conv(get()), step, (v) => { set(v); void persist(); }), unit));
  }

  function buildForm(): void {
    form.replaceChildren(h('h2', {}, '装配误差输入'), effBox, h('div', { class: 'form-grid' }));
    const grid = form.querySelector('.form-grid') as HTMLElement;
    const append = (node: HTMLElement): void => grid.append(node);

    if (isBevel) {
      append(labeledField('小轮安装距偏差 ΔM1', numInput(asm.pinionMountingError * 1000, 10, (v) => { asm.pinionMountingError = v / 1000; void persist(); }), 'μm'));
      append(labeledField('大轮安装距偏差 ΔM2', numInput(asm.gearMountingError * 1000, 10, (v) => { asm.gearMountingError = v / 1000; void persist(); }), 'μm'));
      append(labeledField('轴交角偏差 ΔΣ', numInput(rad2deg(asm.shaftAngleError), 0.01, (v) => { asm.shaftAngleError = deg2rad(v); void persist(); }), '°'));
      append(labeledField('轴线交错(附加)', numInput(rad2deg(asm.parallelismCross), 0.01, (v) => { asm.parallelismCross = deg2rad(v); void persist(); }), '°'));
    } else {
      append(labeledField('中心距偏差 Δa', numInput(asm.centerDistanceError * 1000, 5, (v) => { asm.centerDistanceError = v / 1000; void persist(); }), 'μm'));
      append(labeledField('面内平行度 fΣβ', numInput(rad2deg(asm.parallelismInPlane), 0.005, (v) => { asm.parallelismInPlane = deg2rad(v); void persist(); }), '°'));
      append(labeledField('交错度 fΣδ', numInput(rad2deg(asm.parallelismCross), 0.005, (v) => { asm.parallelismCross = deg2rad(v); void persist(); }), '°'));
    }
    append(labeledField('箱体额定扭矩 T', numInput(asm.housingTorque, 10, (v) => { asm.housingTorque = v; void persist(); }), 'N·m'));
    append(labeledField('箱体偏斜刚度 K', numInput(Number.isFinite(asm.housingStiffness) ? asm.housingStiffness : 0, 1e5, (v) => { asm.housingStiffness = v <= 0 ? Infinity : v; void persist(); }), 'N·m/rad'));

    form.append(
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => { asm = blankAssembly(pair.id); buildForm(); drawEff(); void persist(); } }, '归零'),
        h('button', {
          class: 'btn',
          onclick: () => {
            const copy: AssemblyError = { ...asm, id: uid('asm'), name: '复制 ' + asm.name };
            void saveAssembly(copy).then(() => toast('已复制误差方案', 'ok'));
          },
        }, '另存为新方案'),
      ),
    );
    drawEff();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  async function persist(): Promise<void> {
    drawEff();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void saveAssembly(asm), 300);
  }

  const selector = h('select', {
    onchange: (e: Event) => {
      const found = getState().assemblies.find((a) => a.id === (e.target as HTMLSelectElement).value);
      if (found) { asm = found; buildForm(); }
    },
  }, ...state.assemblies.filter((a) => a.pairId === pair.id).map((a) => new Option(a.name, a.id, a.id === asm.id, a.id === asm.id)));

  root.append(h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, selector,
    h('button', { class: 'btn btn-primary', onclick: () => { asm = blankAssembly(pair.id); void saveAssembly(asm).then(() => { buildForm(); toast('已新建误差方案', 'ok'); }); } }, '新建误差方案')), form));
  buildForm();
  void bind;
  return root;
}
