import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { Logo } from './Logo';

export function FullScreenLoader({ label = t('Loading') }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-2xl bg-brand/20" />
          <Logo className="relative h-12 w-12" />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-subtle">
          {label}
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="h-1 w-1 rounded-full bg-subtle"
                animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
            ))}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="grid h-[50vh] place-items-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  );
}
