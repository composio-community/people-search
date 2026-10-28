import type { CSSProperties } from "react";

/** One screen-width tile of blocks: [left, top, width, height] in %, and a colour. */
type Block = [number, number, number, number, string];

// Composio brand blues, cyan, mint, cream and the warm spectrum.
const BASE: Block[] = [
  [0, 0, 15, 24, "#3d8bff"],
  [15, 0, 9, 58, "#5cc8ff"],
  [24, 0, 38, 21, "#3d8bff"],
  [62, 0, 14, 46, "#66e3ff"],
  [76, 0, 24, 30, "#2b6cff"],
  [0, 24, 15, 36, "#0007cd"],
  [24, 21, 38, 37, "#2b6cff"],
  [76, 30, 24, 26, "#3d8bff"],
  [62, 46, 14, 10, "#00ffff"],
  [0, 60, 22, 26, "#1146ff"],
  [22, 58, 40, 28, "#51a2ff"],
  [62, 56, 22, 30, "#5cc8ff"],
  [84, 56, 16, 26, "#3fffdd"],
  [0, 86, 28, 14, "#f6a6b8"],
  [28, 86, 30, 14, "#66e3ff"],
  [58, 86, 26, 14, "#fdffc2"],
  [84, 82, 16, 18, "#eec2f7"],
];

const GLOW: Block[] = [
  [8, 10, 10, 18, "#00ffff"],
  [40, 30, 16, 22, "#66e3ff"],
  [55, 4, 8, 14, "#51a2ff"],
  [70, 64, 12, 16, "#fdffc2"],
  [20, 70, 14, 12, "#eec2f7"],
];

function Strip({ blocks, className }: { blocks: Block[]; className: string }) {
  // Three copies side by side; panning by one copy loops seamlessly with the
  // strip's blurred edges always off screen.
  return (
    <div className={className}>
      {[0, 1, 2].map((copy) => (
        <div key={copy} className="mosaic-tile">
          {blocks.map(([left, top, width, height, color], i) => (
            <span
              key={i}
              style={
                {
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${width}%`,
                  height: `${height}%`,
                  background: color,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The brand's blurred block texture, drifting left to right behind the start screen. */
export function Mosaic() {
  return (
    <div className="mosaic" aria-hidden>
      <Strip blocks={BASE} className="mosaic-strip mosaic-base" />
      <Strip blocks={GLOW} className="mosaic-strip mosaic-glow" />
      <div className="mosaic-grain" />
    </div>
  );
}
