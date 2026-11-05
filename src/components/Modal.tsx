import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}

export function Modal({ title, eyebrow, children, onClose, className = '' }: Props) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>{eyebrow && <span className="mini-label">{eyebrow}</span>}<h2 id="modal-title">{title}</h2><button className="modal-close" onClick={onClose} aria-label="关闭对话框" autoFocus><X size={19} /></button></header>
        {children}
      </section>
    </div>
  );
}
