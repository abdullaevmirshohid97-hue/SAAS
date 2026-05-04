import { useEffect } from 'react';

interface Props {
  active: boolean;
  durationMs?: number;
}

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export function Confetti({ active, durationMs = 3000 }: Props) {
  useEffect(() => {
    if (!active) return;
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
    document.body.appendChild(root);

    const count = 120;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      const color = COLORS[i % COLORS.length];
      const left = Math.random() * 100;
      const delay = Math.random() * 600;
      const duration = 2200 + Math.random() * 1400;
      const rot = Math.random() * 360;
      const size = 6 + Math.random() * 8;
      piece.style.cssText = `
        position:absolute;top:-20px;left:${left}vw;
        width:${size}px;height:${size * 1.6}px;
        background:${color};opacity:.95;
        transform:rotate(${rot}deg);
        animation:clary-confetti-fall ${duration}ms ${delay}ms cubic-bezier(.2,.6,.4,1) forwards;
      `;
      root.appendChild(piece);
    }

    const styleId = 'clary-confetti-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `@keyframes clary-confetti-fall {
        to { transform: translateY(110vh) rotate(720deg); opacity: 0; }
      }`;
      document.head.appendChild(style);
    }

    const t = setTimeout(() => {
      root.remove();
    }, durationMs + 800);
    return () => {
      clearTimeout(t);
      root.remove();
    };
  }, [active, durationMs]);

  return null;
}
