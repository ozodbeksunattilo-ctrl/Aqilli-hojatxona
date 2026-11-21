import { backend } from '@/services';
import { useAsync } from './useAsync';

export function useSettings() {
  return useAsync(() => backend.getSettings(), [], { live: ['settings'] });
}
