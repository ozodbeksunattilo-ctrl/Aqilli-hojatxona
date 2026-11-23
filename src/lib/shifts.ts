import { secondsBetween } from './format';
import type { Shift } from '@/types/domain';

type ShiftCounts = {
  total_count: number;
  late_male_count?: number | null;
  late_female_count?: number | null;
};

/** Live passages plus passages synced after the shift was closed. */
export const shiftVisitors = (s: ShiftCounts) =>
  s.total_count + (s.late_male_count ?? 0) + (s.late_female_count ?? 0);

/** Stored duration, or the real start/end interval for older records without it. */
export const shiftSeconds = (s: Shift) =>
  s.duration_seconds ?? secondsBetween(s.start_time, s.end_time);
