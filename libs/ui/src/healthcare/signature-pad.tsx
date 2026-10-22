"use client";

import * as React from "react";
import { EraserIcon } from "lucide-react";
import { normalizeStrokes, type PadPoint, type SignatureStroke } from "@healthcare/domain";
import { Button } from "../primitives/button";

const WIDTH = 600;
const HEIGHT = 200;

/**
 * A drawing pad for a signature (3:1). Collects what is drawn with a finger, pen or mouse and reports it as strokes in
 * 0..1; it keeps nothing and sends nothing itself. Keyboard users cannot draw: they use the paper route (print the form).
 */
export function SignaturePad({ id, onChange, disabled = false }: { id: string; onChange: (strokes: SignatureStroke[]) => void; disabled?: boolean }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const strokes = React.useRef<PadPoint[][]>([]);
  const drawing = React.useRef(false);
  const [empty, setEmpty] = React.useState(true);

  const context = () => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111111";
    }
    return ctx;
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>): PadPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  };

  const report = () => onChange(normalizeStrokes(strokes.current, WIDTH, HEIGHT));

  const clear = () => {
    strokes.current = [];
    context()?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange([]);
  };

  return (
    <div className="grid gap-1.5">
      <canvas
        ref={canvas}
        id={id}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Signature pad: draw the signature here"
        className="aspect-[3/1] w-full max-w-md touch-none rounded-md border bg-white"
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const p = point(event);
          strokes.current.push([p]);
          const ctx = context();
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
          ctx?.lineTo(p.x + 0.01, p.y);
          ctx?.stroke();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const p = point(event);
          const current = strokes.current[strokes.current.length - 1];
          if (!current) return;
          const previous = current[current.length - 1]!;
          current.push(p);
          const ctx = context();
          ctx?.beginPath();
          ctx?.moveTo(previous.x, previous.y);
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          setEmpty(false);
          report();
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={clear} disabled={empty || disabled}>
          <EraserIcon aria-hidden /> Clear
        </Button>
        <span className="text-meta text-muted-foreground">Draw with a finger, pen or mouse.</span>
      </div>
    </div>
  );
}
