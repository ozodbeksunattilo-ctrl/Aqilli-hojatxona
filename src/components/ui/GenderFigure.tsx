import type { Gender } from '@/types/domain';

/** Filled restroom pictogram (man / woman), sized via className. */
export function GenderFigure({ gender, className }: { gender: Gender; className?: string }) {
  return gender === 'male' ? (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="4.2" r="2.3" />
      <rect x="9.1" y="7.4" width="5.8" height="8" rx="1.9" />
      <rect x="9.7" y="13" width="1.9" height="8.4" rx="0.95" />
      <rect x="12.4" y="13" width="1.9" height="8.4" rx="0.95" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="4.2" r="2.3" />
      <path d="M10.4 7.4h3.2a1.6 1.6 0 0 1 1.54 1.16L17.2 15.6H6.8l2.06-7.04A1.6 1.6 0 0 1 10.4 7.4Z" />
      <rect x="10" y="14.6" width="1.8" height="6.8" rx="0.9" />
      <rect x="12.2" y="14.6" width="1.8" height="6.8" rx="0.9" />
    </svg>
  );
}
