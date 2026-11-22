/** 轻量 DOM 助手 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export interface FieldDef {
  key: string;
  label: string;
  step?: string;
  unit?: string;
  type?: 'number' | 'text' | 'select';
  options?: [string, string][]; // select: [value, label]
}

/** 生成表单行,返回 {row, input} */
export function fieldRow(def: FieldDef, value: string | number): { row: HTMLElement; input: HTMLInputElement | HTMLSelectElement } {
  const unit = def.unit ? ` (${def.unit})` : '';
  const label = el('label', {}, [def.label + unit]);
  let input: HTMLInputElement | HTMLSelectElement;
  if (def.type === 'select') {
    input = el('select', { name: def.key });
    for (const [v, l] of def.options ?? []) input.append(el('option', { value: v }, [l]));
    input.value = String(value);
  } else {
    input = el('input', {
      name: def.key,
      type: def.type === 'text' ? 'text' : 'number',
      step: def.step ?? 'any',
      value: String(value),
    });
  }
  const row = el('div', { class: 'field-row' }, [label, input]);
  return { row, input };
}

/** 从表单容器收集数值 */
export function collectNumbers(container: HTMLElement): Record<string, number> {
  const out: Record<string, number> = {};
  container.querySelectorAll<HTMLInputElement>('input[type=number]').forEach((i) => {
    out[i.name] = parseFloat(i.value) || 0;
  });
  return out;
}

export function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

export function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
