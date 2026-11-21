import { describe, expect, it } from 'vitest';
import { toCsv } from '@/utils/csv';
import { connectionOf } from '@/lib/devices';
import type { Device } from '@/types/domain';

describe('CSV export', () => {
  it('quotes separators and neutralises spreadsheet formulas', () => {
    const csv = toCsv(
      [{ name: '=HYPERLINK("http://x")', note: 'a,b', n: 5 }, { name: 'Asqar "A"', note: '', n: 0 }],
      [
        { header: 'Name', value: (r) => r.name },
        { header: 'Note', value: (r) => r.note },
        { header: 'N', value: (r) => r.n },
      ],
    );
    expect(csv.split('\r\n')).toEqual([
      'Name,Note,N',
      `"'=HYPERLINK(""http://x"")","a,b",5`,
      '"Asqar ""A""",,0',
    ]);
  });
});

describe('device connection status', () => {
  const base: Device = {
    id: 'MEN-001', device_name: 'x', device_type: 'tripod_turnstile', restroom_type: 'male', status: 'active',
    last_seen: null, last_event_at: null, firmware_version: null, queue_depth: null, token_rotated_at: null,
  };
  const now = Date.parse('2026-11-21T10:00:00Z');

  it('derives online / offline / never seen / disabled / maintenance', () => {
    expect(connectionOf(base, 90, now)).toBe('never_seen');
    expect(connectionOf({ ...base, last_seen: '2026-11-21T09:59:00Z' }, 90, now)).toBe('online');
    expect(connectionOf({ ...base, last_seen: '2026-11-21T09:50:00Z' }, 90, now)).toBe('offline');
    expect(connectionOf({ ...base, status: 'disabled', last_seen: '2026-11-21T09:59:59Z' }, 90, now)).toBe('disabled');
    expect(connectionOf({ ...base, status: 'maintenance', last_seen: '2026-11-21T09:59:59Z' }, 90, now)).toBe('maintenance');
  });
});
