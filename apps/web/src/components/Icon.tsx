// Stroke icons from the prototype (ui-redesign/app.js `I`), 24 × 24, decorative only.
const PATHS = {
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z',
  map: 'M15 2H9L3 5v17l6-3 6 3 6-3V2zM9 2v17M15 5v17',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  plus: 'M12 5v14M5 12h14',
  route: 'M6 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chevL: 'm15 18-6-6 6-6',
  gps: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  location: 'M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  close: 'M18 6 6 18M6 6l12 12',
} as const;

export function Icon({ name, size = 22, strokeWidth = 2 }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
