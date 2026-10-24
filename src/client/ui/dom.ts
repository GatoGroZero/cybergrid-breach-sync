export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer: number | null = null;

export function toast(message: string): void {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 3200);
}

/** Mueve el foco al abrir un panel modal y lo devuelve al cerrarlo. */
export function trapFocus(root: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const first = root.querySelector<HTMLElement>('button, input, select, [tabindex]');
  first?.focus({ preventScroll: true });
  return () => previous?.focus?.({ preventScroll: true });
}
