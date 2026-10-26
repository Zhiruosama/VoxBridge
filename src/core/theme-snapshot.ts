/** Paint the old surface before switching themes on WebViews without View Transitions. */
export function fadeThemeSnapshot(source: HTMLElement, commit: () => void): () => void {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const layer = source.cloneNode(true) as HTMLElement;
  const originals = source.querySelectorAll<HTMLElement>('*');
  const copies = layer.querySelectorAll<HTMLElement>('*');
  // Read everything before appending/writing the clone. Interleaving reads and
  // writes here causes repeated layout on WKWebView, especially in long feeds.
  const scroll = Array.from(originals, (element) => [element.scrollLeft, element.scrollTop]);
  for (const property of Array.from(style)) {
    if (property.startsWith('--'))
      layer.style.setProperty(property, style.getPropertyValue(property));
  }
  layer.style.color = style.color;
  layer.style.colorScheme = root.dataset.theme === 'light' ? 'light' : 'dark';
  layer.removeAttribute('id');
  layer.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  layer.classList.add('theme-snapshot');
  layer.inert = true;
  layer.setAttribute('aria-hidden', 'true');
  // cloneNode does not reliably preserve edited textarea/select values.
  const controls = source.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,textarea,select');
  const controlCopies = layer.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,textarea,select');
  controls.forEach((control, index) => {
    controlCopies[index].value = control.value;
    if (control.tagName === 'INPUT') {
      (controlCopies[index] as HTMLInputElement).checked = (control as HTMLInputElement).checked;
    }
  });
  document.body.append(layer);
  copies.forEach((element, index) => {
    element.scrollLeft = scroll[index][0];
    element.scrollTop = scroll[index][1];
  });
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number;
  const dispose = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    layer.remove();
  };
  layer.addEventListener('animationend', (event) => {
    if (event.target === layer) dispose();
  });
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (cancelled) return;
      // A paint separates snapshot creation from the theme mutation. Starting
      // the timer during cloning can otherwise expire before the first frame.
      commit();
      layer.dataset.playing = 'true';
      timer = setTimeout(dispose, 440);
    });
  });
  return dispose;
}
