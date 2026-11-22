import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 15.9l-1.7-4.5L5.8 9.7 10.3 8 12 3.5Z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      <path d="M5 3.5l.5 1.5L7 5.5 5.5 6 5 7.5 4.5 6 3 5.5l1.5-.5L5 3.5Z" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7h3.5c1.2 0 2.3.6 3 1.6l5 7c.7 1 1.8 1.6 3 1.6H21" />
      <path d="m18 4 3 3-3 3" />
      <path d="M3 17h3.5c1.2 0 2.3-.6 3-1.6l.7-1" />
      <path d="m13.2 9.4.8-1.2c.7-1 1.8-1.6 3-1.6H21" />
      <path d="m18 14 3 3-3 3" />
    </Svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </Svg>
  );
}

export function CubeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.8 21 8v8l-9 5.2L3 16V8l9-5.2Z" />
      <path d="M3.4 8.2 12 13l8.6-4.8M12 13v8.2" />
    </Svg>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5h11L20.5 8v12.5h-17v-17Z" />
      <path d="M8 3.5v5h7v-5M8 20.5v-7h8v7" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19.5 7" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14 21l-3.5-7.5L3 10l18-7Z" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 9A8 8 0 0 1 19 7l1.5 2" />
      <path d="M20.5 4v5h-5" />
      <path d="M19.5 15A8 8 0 0 1 5 17l-1.5-2" />
      <path d="M3.5 20v-5h5" />
    </Svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16v16H4zM4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" />
    </Svg>
  );
}

export function FocusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
      <circle cx="12" cy="12" r="3.2" />
    </Svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 5-5 4 4 2.5-2.5L20 18" />
    </Svg>
  );
}

export function WandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20 16.5 7.5" />
      <path d="m14.5 5.5 4 4" />
      <path d="M18 3v3M21 6h-3M8 4.5v2M9 5.5H7M5.5 9v2M6.5 10h-2" />
    </Svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.4" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5h16v11H9L4 20V5.5Z" />
      <path d="M8 9h8M8 12.5h5" />
    </Svg>
  );
}

export function TreeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 5.5 13h4L6.5 18h11L14.5 13h4L12 3Z" />
      <path d="M12 18v3" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h7M15 7h5M4 17h4M12 17h8" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Svg>
  );
}

export function MaximizeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    </Svg>
  );
}

export function MinimizeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" />
    </Svg>
  );
}

export function MouseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="3" width="10" height="18" rx="5" />
      <path d="M12 3v6" />
    </Svg>
  );
}
