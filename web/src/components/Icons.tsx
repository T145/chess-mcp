import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props
  };
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function FlipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4v16M17 4v16M7 9l-3 3 3 3M17 9l3 3-3 3" />
    </svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V4M5 4h11l-1.5 4L16 12H5" />
    </svg>
  );
}

export function HandshakeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m11 17 2 2a1 1 0 0 0 1.4 0l3.6-3.6a2 2 0 0 0 0-2.8L13 7l-3 3" />
      <path d="m2 12 4-4 3 3M22 12l-4-4-3 3" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 9a15 15 0 0 1 18 0M6 13a10 10 0 0 1 12 0M9 17a5 5 0 0 1 6 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 9a15 15 0 0 1 5-2.6M14 6.2A15 15 0 0 1 21 9M6 13a10 10 0 0 1 4-1.7M14 11.2A10 10 0 0 1 18 13M9 17a5 5 0 0 1 5-.7M3 3l18 18" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
