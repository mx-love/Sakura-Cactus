export function getReadingProgress(
  scrollY: number,
  articleTop: number,
  articleHeight: number,
  viewportHeight: number,
  headerHeight: number
): number {
  const start = Math.max(0, articleTop - headerHeight);
  const end = Math.max(0, articleTop + articleHeight - viewportHeight);

  if (end <= start) return scrollY >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (scrollY - start) / (end - start)));
}

export function bindReadingProgress(): void {
  const bar = document.querySelector('[data-reading-progress]');
  const article = document.querySelector('.sc-article-prose');
  if (!(bar instanceof HTMLElement) || !(article instanceof HTMLElement)) return;

  const progressBar = bar;
  const content = article;
  const header = document.querySelector('.sc-site-header');
  let frame = 0;

  function update() {
    frame = 0;
    const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
    const rect = content.getBoundingClientRect();
    const progress = getReadingProgress(window.scrollY, rect.top + window.scrollY, rect.height, window.innerHeight, headerHeight);
    document.documentElement.style.setProperty('--sc-reading-progress-top', `${Math.round(headerHeight)}px`);
    progressBar.style.transform = `scaleX(${progress})`;
  }

  function scheduleUpdate() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('pageshow', scheduleUpdate);
  window.addEventListener('pagehide', () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
  });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(content);
    if (header instanceof HTMLElement) observer.observe(header);
  }

  scheduleUpdate();
}
