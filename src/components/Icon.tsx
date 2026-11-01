import type { ReactNode } from "react";

// Interface decorations use SVG so they remain readable with the same small
// system-font installation used by the private production renderer.
const artwork = {
  plus: <path d="M12 5v14M5 12h14" />,
  sparkle: (
    <>
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" />
      <path d="M20 2v4M18 4h4" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
    </>
  ),
  "arrow-up-right": <path d="M5 19 19 5M5 5h14v14" />,
  "return-key": <path d="M20 4v8H4M9 7l-5 5 5 5" />,
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M7 12h10" />
    </>
  ),
  landscape: (
    <>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="m3 19 6-9 5 7 3-4 5 7" />
    </>
  ),
  nodes: (
    <>
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="20" cy="12" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="m10.5 5.5-5 5M13.5 5.5l5 5M5.5 13.5l5 5M18.5 13.5l-5 5M6 12h12" />
    </>
  ),
  typography: (
    <>
      <path d="M3 5h12M9 5v15M6 20h6M17 10h5M19.5 10v10M17 20h5" />
    </>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  "rotate-left": (
    <>
      <path d="M4 10a8 8 0 1 1 2 8M4 4v6h6" />
    </>
  ),
  "rotate-right": (
    <>
      <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof artwork;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="studio-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {artwork[name]}
    </svg>
  );
}
