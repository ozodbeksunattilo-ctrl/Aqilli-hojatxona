import type {
  ActiveShift,
  ActivityLog,
  DailyReport,
  DailyStat,
  Device,
  DeviceLog,
  EmployeePerformance,
  EntryEvent,
  HourStat,
  Profile,
  Settings,
  Shift,
  ShiftFilter,
  TodaySummary,
} from '@/types/domain';

export type LiveTopic = 'events' | 'shifts' | 'devices' | 'settings';

/**
 * Everything the UI needs from the server. Two implementations:
 *  - SupabaseBackend: production (Postgres + RLS + RPC + Realtime + Edge Functions)
 *  - DemoBackend: self-contained in-browser demo used when Supabase is not configured
 */
export interface Backend {
  readonly kind: 'supabase' | 'demo';

  // auth
  signIn(username: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  currentProfile(): Promise<Profile | null>;
  onAuthChange(cb: () => void): () => void;

  // shifts
  getActiveShifts(): Promise<ActiveShift[]>;
  startShift(): Promise<Shift>;
  endShift(shiftId: string): Promise<Shift>;
  listShifts(filter: ShiftFilter): Promise<Shift[]>;

  // events & stats
  listEvents(opts: { shiftId?: string; limit?: number }): Promise<EntryEvent[]>;
  getTodaySummary(): Promise<TodaySummary>;
  getDailyStats(from: string, to: string): Promise<DailyStat[]>;
  getHourlyDistribution(from: string, to: string): Promise<HourStat[]>;
  getEmployeePerformance(from: string, to: string): Promise<EmployeePerformance[]>;
  getDailyReport(day: string): Promise<DailyReport>;

  // employees
  listEmployees(): Promise<Profile[]>;
  createEmployee(input: { username: string; full_name: string; password: string }): Promise<void>;
  updateEmployee(id: string, input: { full_name: string }): Promise<void>;
  setEmployeeActive(id: string, active: boolean): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;

  // devices
  listDevices(): Promise<Device[]>;
  listDeviceLogs(opts: { deviceId?: string; limit?: number }): Promise<DeviceLog[]>;
  updateDevice(id: string, input: { device_name?: string; status?: Device['status'] }): Promise<void>;
  rotateDeviceToken(id: string): Promise<string>;
  simulatePassage(deviceId: string): Promise<void>;

  // settings & audit
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  listActivity(limit: number): Promise<ActivityLog[]>;
  telegramStatus(): Promise<{ bot_configured: boolean; chats: number }>;
  telegramTest(): Promise<void>;

  /** Push notifications for live dashboards. Returns an unsubscribe function. */
  subscribe(cb: (topic: LiveTopic) => void): () => void;
  /** Base URL of the hardware endpoint, for the integration panel. */
  hardwareEndpoint(): string;
}

export class BackendError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}
