/**
 * 极简 DOM 构建工具, 避免引入框架
 */
export type ElChild = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, node: Node): void {
  el.replaceChildren(node);
}

export function labeledField(
  label: string,
  input: HTMLElement,
  unit?: string,
): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, unit ? h('span', { class: 'field-unit' }, unit) : null);
}

export function numInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    step: String(step),
    value: roundDisplay(value),
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  return input;
}

function roundDisplay(v: number): number {
  if (v === 0) return 0;
  const abs = Math.abs(v);
  if (abs < 1e-6) return parseFloat(v.toExponential(3));
  if (abs < 0.01) return parseFloat(v.toFixed(6));
  if (abs < 1) return parseFloat(v.toFixed(5));
  return parseFloat(v.toFixed(4));
}

export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}
