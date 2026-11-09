// Verschieben und Zoomen eines SVG-Inhalts per Maus (Ziehen, Mausrad) und Touch (Wischen, Pinch).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface View {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.6;
const MAX_SCALE = 4;
const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };

function toSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function zoomAround(v: View, px: number, py: number, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const f = scale / v.scale;
  return { scale, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
}

export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>) {
  const [view, setView] = useState<View>(IDENTITY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  /** true, sobald sich der Zeiger merklich bewegt hat – dann ist es kein Tippen mehr */
  const dragged = useRef(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onDown = (e: PointerEvent) => {
      pointers.current.set(e.pointerId, toSvg(svg, e.clientX, e.clientY));
      if (pointers.current.size === 1) dragged.current = false;
      pinchDist.current = null;
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const cur = toSvg(svg, e.clientX, e.clientY);
      // Erst beim Ziehen einfangen – sonst landen Klicks nicht mehr auf den Feldern.
      if (dragged.current && !svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);

      if (pointers.current.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (Math.hypot(dx, dy) > 0.02) dragged.current = true;
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      } else if (pointers.current.size === 2) {
        dragged.current = true;
        pointers.current.set(e.pointerId, cur);
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current !== null && dist > 0) {
          const factor = dist / pinchDist.current;
          setView((v) => zoomAround(v, (a.x + b.x) / 2, (a.y + b.y) / 2, factor));
        }
        pinchDist.current = dist;
        return;
      }
      pointers.current.set(e.pointerId, cur);
    };

    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      pinchDist.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(svg, e.clientX, e.clientY);
      setView((v) => zoomAround(v, p.x, p.y, Math.exp(-e.deltaY * 0.0015)));
    };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('wheel', onWheel);
    };
  }, [svgRef]);

  const reset = useCallback(() => setView(IDENTITY), []);
  const zoomBy = useCallback((factor: number) => setView((v) => zoomAround(v, 0, 0, factor)), []);

  return { view, reset, zoomBy, wasDragged: () => dragged.current };
}
