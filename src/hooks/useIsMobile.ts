import { useEffect, useState } from 'react';

/**
 * Retorna true se a largura da janela for menor ou igual ao breakpoint (padrão 1249px).
 */
export function useIsMobile(breakpoint = 1249): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    update(mediaQuery);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    } else {
      mediaQuery.addListener(update);
      return () => mediaQuery.removeListener(update);
    }
  }, [breakpoint]);

  return isMobile;
}
