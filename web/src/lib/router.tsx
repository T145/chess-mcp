import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return pathname;
}

export function Link({
  to,
  children,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
