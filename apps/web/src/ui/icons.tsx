// H6 — one small, consistent icon set (24px grid, 1.75 stroke, currentColor). Decorative: always aria-hidden.
import type { ReactNode } from "react";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);

export const IconArrow = (p: { size?: number }) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconCheck = (p: { size?: number }) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconCross = (p: { size?: number }) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconBridge = (p: { size?: number }) => <Svg {...p}><path d="M3 17h18M5 17V9M19 17V9M3 9c3 0 5-3 9-3s6 3 9 3M9 17v-4M15 17v-4" /></Svg>;
export const IconLayers = (p: { size?: number }) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></Svg>;
export const IconShield = (p: { size?: number }) => <Svg {...p}><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IconEye = (p: { size?: number }) => <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconCode = (p: { size?: number }) => <Svg {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></Svg>;
export const IconLock = (p: { size?: number }) => <Svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const IconExternal = (p: { size?: number }) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>;
export const IconChevron = (p: { size?: number }) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
