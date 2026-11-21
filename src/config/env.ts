const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const env = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anonKey ?? '',
  authEmailDomain: (import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string | undefined) ?? 'smartrestroom.local',
  /**
   * Local demo: no Supabase credentials → a self-contained in-browser backend
   * with seeded demo data. Never used when Supabase is configured.
   */
  localDemo: !url || !anonKey || import.meta.env.VITE_LOCAL_DEMO === 'true',
};
