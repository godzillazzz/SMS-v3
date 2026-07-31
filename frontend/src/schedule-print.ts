export async function printScheduleDocument(print: () => void = () => window.print()): Promise<void> {
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

  print();
}
