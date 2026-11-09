import { useEffect } from 'react';
// One delegated listener; no timers, observers or animation loop.
export default function useInterfaceMotion(reduced: boolean) {
  useEffect(() => {
    if (reduced) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const press = (event: MouseEvent) => {
      if (media.matches || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(
        '.icon-button,.close-btn,.primary,.secondary,.browse-button',
      );
      if (!control || control.matches(':disabled') || !control.animate) return;
      for (const animation of control.getAnimations()) animation.cancel();
      control.animate([{ scale: '1' }, { scale: '.96' }, { scale: '1' }], {
        duration: 160,
        easing: 'ease-out',
      });
    };
    document.addEventListener('click', press);
    return () => document.removeEventListener('click', press);
  }, [reduced]);
}
