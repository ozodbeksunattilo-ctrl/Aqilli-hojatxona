export type Role = 'admin' | 'employee';
export type Gender = 'male' | 'female';
export type ShiftStatus = 'active' | 'completed';
export type EventSource = 'hardware' | 'simulated';
export type SystemMode = 'demo' | 'production';

export interface Profile {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Shift {
  id: string;
  employee_id: string;
  employee_name: string;
  start_time: string;
  end_time: string | null;
  male_count: number;
  female_count: number;
  total_count: number;
  late_male_count: number;
  late_female_count: number;
  status: ShiftStatus;
  duration_seconds: number | null;
  end_reason: 'employee' | 'admin_forced' | null;
}

export interface ActiveShift {
  id: string;
  employee_id: string;
  employee_name: string;
  start_time: string;
  male_count: number;
  female_count: number;
  total_count: number;
}

export interface EntryEvent {
  id: number;
  event_id: string;
  shift_id: string | null;
  device_id: string;
  gender: Gender;
  occurred_at: string;
  created_at: string;
  source: EventSource;
  attribution: 'live' | 'late' | 'unassigned';
}

export interface Device {
  id: string;
  device_name: string;
  device_type: string;
  restroom_type: Gender;
  status: 'active' | 'maintenance' | 'disabled';
  last_seen: string | null;
  last_event_at: string | null;
  firmware_version: string | null;
  queue_depth: number | null;
  token_rotated_at: string | null;
}

export interface DeviceLog {
  id: number;
  device_id: string | null;
  event_id: string | null;
  event_type: string;
  result: string;
  source: EventSource | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface HourStat {
  hour: number;
  male: number;
  female: number;
}

export interface TodaySummary {
  date: string;
  male: number;
  female: number;
  total: number;
  unassigned: number;
  simulated: number;
  completed_shifts: number;
  active_shifts: number;
  hourly: HourStat[];
}

export interface DailyStat {
  day: string;
  male: number;
  female: number;
  total: number;
}

export interface EmployeePerformance {
  employee_id: string;
  full_name: string;
  username: string;
  is_active: boolean;
  shifts: number;
  male: number;
  female: number;
  total: number;
  hours: number;
  per_hour: number;
}

export interface DailyReport {
  date: string;
  business: string;
  male: number;
  female: number;
  total: number;
  unassigned: number;
  employees: { name: string; shifts: number; male: number; female: number; total: number }[];
}

export interface Settings {
  business_name: string;
  business_location: string;
  timezone: string;
  system_mode: SystemMode;
  single_shared_shift: boolean;
  device_offline_after_seconds: number;
  telegram_enabled: boolean;
  telegram_admin_ids: number[];
  notify_shift_start: boolean;
  notify_shift_end: boolean;
  notify_daily_report: boolean;
  daily_report_hour: number;
}

export interface ActivityLog {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ShiftFilter {
  employeeId?: string;
  from?: string; // yyyy-mm-dd (inclusive)
  to?: string; // yyyy-mm-dd (inclusive)
  status?: ShiftStatus;
  limit?: number;
}
