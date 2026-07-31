export async function printScheduleDocument(print: () => void = () => window.print()): Promise<void> {
  const printRoot = typeof document !== 'undefined' ? document.documentElement : undefined;
  const cleanup = () => {
    printRoot?.classList.remove('schedule-printing');
    if (typeof window !== 'undefined') window.removeEventListener('afterprint', cleanup);
  };

  printRoot?.classList.add('schedule-printing');
  if (typeof window !== 'undefined') window.addEventListener('afterprint', cleanup, { once: true });

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      return;
    }
    setTimeout(resolve, 0);
  });

  if (typeof document !== 'undefined') void document.body.offsetHeight;
  try {
    print();
    if (typeof window !== 'undefined') window.setTimeout(cleanup, 1000);
  } catch (error) {
    cleanup();
    throw error;
  }
}
