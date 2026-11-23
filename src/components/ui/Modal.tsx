import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n/I18nProvider';

export function Modal({ open, onClose, title, description, children, footer, className }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div role="dialog" aria-modal
            className={cn('card relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-b-none bg-surface sm:rounded-2xl', className)}
            initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
              </div>
              <button onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-subtle hover:bg-elevated hover:text-fg" aria-label={t('Close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {children && <div className="px-6 py-5">{children}</div>}
            {footer && <div className="flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
