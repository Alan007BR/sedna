// A small square of sky drawn pixel for pixel, with an optional centre mark and a caption.
// Shared by the next-visit close-up and the Sedna stacks.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useRef } from "react";
import { renderFrame } from "./lib/render";

type Props = { img: Float32Array; size: number; limits: { lo: number; hi: number }; label: string; mark?: boolean; width?: number };

export default function Stamp({ img, size, limits, label, mark = true, width = 180 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    renderFrame(img, size, out, { limits, softening: 4, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [img, size, limits]);
  const m = (size - 1) / 2 + 0.5;
  const gap = Math.max(2, size / 10);
  const len = Math.max(4, size / 5);
  return (
    <figure className="zoom">
      <div className="zoom-frame" style={{ width }}>
        <canvas ref={ref} />
        {mark && (
          <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            <g stroke="var(--red-text)" strokeWidth={size / 110} strokeLinecap="round">
              <line x1={m - len} y1={m} x2={m - gap} y2={m} />
              <line x1={m + gap} y1={m} x2={m + len} y2={m} />
              <line x1={m} y1={m - len} x2={m} y2={m - gap} />
              <line x1={m} y1={m + gap} x2={m} y2={m + len} />
            </g>
          </svg>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
