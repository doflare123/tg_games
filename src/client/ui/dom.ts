export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
export function button(
  label: string,
  onClick: () => void,
  className = 'button',
): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}
export function formatTime(ticks: number): string {
  const seconds = ticks / 60;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
export function formatMineTime(ms: number): string {
  const centiseconds = Math.floor(ms / 10);
  return `${Math.floor(centiseconds / 6000)
    .toString()
    .padStart(2, '0')}:${Math.floor((centiseconds % 6000) / 100)
    .toString()
    .padStart(2, '0')}.${(centiseconds % 100).toString().padStart(2, '0')}`;
}
