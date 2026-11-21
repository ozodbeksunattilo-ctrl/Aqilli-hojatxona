import { env } from '@/config/env';
import type { Backend } from './backend';
import { DemoBackend } from './demo/demoBackend';
import { SupabaseBackend } from './supabaseBackend';

export const backend: Backend = env.localDemo ? new DemoBackend() : new SupabaseBackend();
export { BackendError } from './backend';
export type { Backend, LiveTopic } from './backend';

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
