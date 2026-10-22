// Small inline icons for buttons and the HUD. They take the text colour
// (currentColor) unless they are coloured badges (Coin, Heart, Timer).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 24, ...rest }: P) => ({ width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, ...rest });

export const IconPlay = (p: P) => (
  <svg {...base(p)}><path d="M7 4.8v14.4a1.4 1.4 0 0 0 2.1 1.2l11.2-7.2a1.4 1.4 0 0 0 0-2.4L9.1 3.6A1.4 1.4 0 0 0 7 4.8z" fill="currentColor" /></svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)}><rect x="6" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor" /></svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><rect x="5" y="10" width="14" height="10.5" rx="3" fill="currentColor" /><circle cx="12" cy="15.2" r="1.7" fill="var(--icon-hole, rgba(0,0,0,.35))" /></svg>
);
export const IconGift = (p: P) => (
  <svg {...base(p)}><rect x="4" y="9" width="16" height="11.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M3 9h18M12 9v11.5M12 9c-2-4-6-4.5-6-2s4 2 6 2zm0 0c2-4 6-4.5 6-2s-4 2-6 2z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
);
export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M3.5 11.2 12 4l8.5 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.5H9.2v5.5H5A1.5 1.5 0 0 1 3.5 19z" fill="currentColor" /></svg>
);
export const IconBack = (p: P) => (
  <svg {...base(p)}><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconNext = (p: P) => (
  <svg {...base(p)}><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconRestart = (p: P) => (
  <svg {...base(p)}><path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /><path d="M18.5 3.5v4.2h-4.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconShare = (p: P) => (
  <svg {...base(p)}><path d="M12 15V4m0 0L7.8 8.2M12 4l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 11.5v6.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
);
export const IconSwords = (p: P) => (
  <svg {...base(p)}><path d="M4 4l9 9M4 4h3.5L14 10.5M4 4v3.5L10.5 14M20 4l-9 9M20 4h-3.5M20 4v3.5M15 15l4.5 4.5M9 15l-4.5 4.5M13 17l4-4M11 17l-4-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="5.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="15" r="2" fill="currentColor" /></svg>
);
export const IconHelp = (p: P) => (
  <svg {...base(p)}><path d="M9 9.2a3 3 0 1 1 4.3 2.7c-.8.4-1.3 1-1.3 1.9v.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /><circle cx="12" cy="18.3" r="1.6" fill="currentColor" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6.5 6.5l11 11m0-11-11 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconUser = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0z" fill="currentColor" /></svg>
);
export const IconSound = ({ muted, ...p }: P & { muted?: boolean }) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" strokeLinejoin="round" />
    {muted ? (
      <path d="M15.5 9.5l5 5m0-5-5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    ) : (
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    )}
  </svg>
);
export const IconDash = (p: P) => (
  <svg {...base(p)}><path d="M4.5 5.5 11 12l-6.5 6.5M12.5 5.5 19 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconFlame = (p: P) => (
  <svg {...base(p)}><path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-4-3.2-6.3-4.3-10.3-2.3 1.6-3.4 3.8-3.3 6-1.1-.6-1.8-1.7-2-3C6.6 9.4 5.5 11.8 5.5 14.8 5.5 18.4 8 21 12 21z" fill="var(--coin, #FFC84A)" stroke="var(--danger, #f55)" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);

/** A gold coin badge with a star. */
export const Coin = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="10.5" fill="color-mix(in srgb, var(--coin) 70%, #b06d00)" />
    <circle cx="12" cy="11.2" r="9.6" fill="var(--coin)" />
    <circle cx="12" cy="11.2" r="7" fill="none" stroke="color-mix(in srgb, var(--coin) 75%, #b06d00)" strokeWidth="1.3" />
    <path d="M12 6.6l1.4 2.9 3.2.4-2.3 2.2.6 3.2L12 13.8l-2.9 1.5.6-3.2-2.3-2.2 3.2-.4z" fill="#fff" opacity=".95" />
  </svg>
);
export const Heart = ({ empty, ...p }: P & { empty?: boolean }) => (
  <svg {...base(p)}>
    <path d="M12 20.5S3 15 3 8.9A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 9 1.9C21 15 12 20.5 12 20.5z" fill={empty ? "color-mix(in srgb, var(--ink) 14%, transparent)" : "var(--danger)"} />
    {empty ? null : <ellipse cx="7.6" cy="8.6" rx="2" ry="1.3" transform="rotate(-35 7.6 8.6)" fill="#fff" opacity=".55" />}
  </svg>
);
export const Timer = (p: P) => (
  <svg {...base(p)}>
    <rect x="10" y="1.5" width="4" height="3" rx="1" fill="var(--accent2)" />
    <circle cx="12" cy="13.5" r="8.5" fill="var(--accent2)" />
    <circle cx="12" cy="13.5" r="6.3" fill="#fff" />
    <path d="M12 9.5v4.2l2.6 1.6" stroke="var(--accent2)" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);
export const Crown = (p: P) => (
  <svg {...base(p)}><path d="M3 8.5l4.5 3.5L12 5l4.5 7L21 8.5 19 18H5z" fill="var(--coin)" stroke="color-mix(in srgb, var(--coin) 70%, #a35f00)" strokeWidth="1.2" strokeLinejoin="round" /><circle cx="12" cy="5" r="1.4" fill="var(--coin)" /></svg>
);
export const Star = (p: P) => (
  <svg {...base(p)}><path d="M12 2.8l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3L2.9 9.4l6.3-.8z" fill="var(--coin)" stroke="color-mix(in srgb, var(--coin) 70%, #a35f00)" strokeWidth="1" strokeLinejoin="round" /></svg>
);
