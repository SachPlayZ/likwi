"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Spark } from "./Logo";

// HF 0.8..2.0 → y 470..30 in a 1000×500 box.
const y = (hf: number) => 470 - ((hf - 0.8) / 1.2) * 440;
const wob = (x: number) => Math.sin(x * 0.09) * 2.5 + Math.sin(x * 0.031) * 3;

function line(f: (t: number) => number) {
  const pts: string[] = [];
  for (let x = 0; x <= 1000; x += 10) pts.push(`${x},${(y(f(x / 1000)) + wob(x)).toFixed(1)}`);
  return "M" + pts.join(" L");
}

const unprotected = line((t) => 1.85 - 0.95 * t ** 1.2);
// Shielded: same crash, but each time HF touches trigger 1.3 a Step pushes it back toward target 1.6.
const STEPS = [0.3, 0.58, 0.82];
const shielded = line((t) => {
  let hf = 1.85 - 0.95 * t ** 1.2;
  for (const s of STEPS) if (t >= s) hf += 0.28;
  return hf;
});

export function HfChart() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const draw = useTransform(scrollYProgress, [0.05, 0.85], [0, 1]);
  const stamp = useTransform(scrollYProgress, [0.78, 0.86], [0, 1]);
  const stampScale = useTransform(scrollYProgress, [0.78, 0.86], [2.2, 1]);
  const caption = useTransform(scrollYProgress, [0, 0.3, 0.6, 0.9], [0, 1, 2, 3]);

  return (
    <section ref={ref} className="relative h-[320vh]">
      <div className="sticky top-0 flex h-screen flex-col justify-center px-6 md:px-16">
        <p className="font-hand text-2xl text-muted-foreground">the same crash, twice —</p>
        <h2 className="font-serif text-5xl md:text-7xl">
          One gets liquidated. <em className="text-muted-foreground">One doesn&apos;t.</em>
        </h2>

        <div className="relative mt-10 w-full max-w-6xl">
          <svg viewBox="0 0 1000 500" className="w-full overflow-visible">
            {[
              [1.6, "target 1.6"],
              [1.3, "trigger 1.3"],
              [1.0, "liquidation 1.0"],
            ].map(([hf, label]) => (
              <g key={label as string}>
                <line
                  x1={0}
                  x2={1000}
                  y1={y(hf as number)}
                  y2={y(hf as number)}
                  stroke="white"
                  strokeOpacity={hf === 1.0 ? 0.6 : 0.2}
                  strokeDasharray="6 8"
                  style={{ filter: "url(#rough)" }}
                />
                <text x={1008} y={y(hf as number) + 5} fill="white" fillOpacity={0.55} className="font-hand" fontSize={20}>
                  {label}
                </text>
              </g>
            ))}
            <rect x={0} y={y(1.0)} width={1000} height={470 - y(1.0)} fill="url(#chartHatch)" />
            <defs>
              <pattern id="chartHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="10" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" />
              </pattern>
            </defs>
            <motion.path
              d={unprotected}
              fill="none"
              stroke="white"
              strokeOpacity={0.45}
              strokeWidth={2.5}
              strokeDasharray="2 7"
              strokeLinecap="round"
              style={{ pathLength: draw, filter: "url(#rough)" }}
            />
            <motion.path
              d={shielded}
              fill="none"
              stroke="white"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pathLength: draw, filter: "url(#rough)" }}
            />
          </svg>

          {STEPS.map((s, i) => (
            <StepSpark key={i} at={s} progress={draw} />
          ))}

          <motion.div
            style={{ opacity: stamp, scale: stampScale, rotate: -8 }}
            className="absolute right-[4%] bottom-[2%] rounded-sm border-4 border-white px-4 py-1 font-mono text-lg font-bold tracking-widest md:text-2xl"
          >
            LIQUIDATED
          </motion.div>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-10 gap-y-2 font-mono text-sm text-muted-foreground">
          <span>
            <span className="text-white">━━</span> shielded borrower
          </span>
          <span>┄┄ unprotected borrower</span>
          <motion.span className="font-hand text-xl text-white">
            <Caption value={caption} />
          </motion.span>
        </div>
      </div>
    </section>
  );
}

const CAPTIONS = ["price starts sliding…", "HF hits trigger → Step #1", "still falling → Step #2", "unshielded loan: gone."];

function Caption({ value }: { value: MotionValue<number> }) {
  const text = useTransform(value, (v) => CAPTIONS[Math.min(3, Math.floor(v))]);
  return <motion.span>{text}</motion.span>;
}

function StepSpark({ at, progress }: { at: number; progress: MotionValue<number> }) {
  const scale = useTransform(progress, [at - 0.01, at + 0.03, at + 0.08], [0, 1.6, 1]);
  const rotate = useTransform(progress, [at, at + 0.1], [-90, 0]);
  const hf = 1.85 - 0.95 * at ** 1.2 + 0.28 * (STEPS.indexOf(at) + 1);
  return (
    <motion.div
      style={{ scale, rotate, left: `${at * 100}%`, top: `${(y(hf) / 500) * 100}%` }}
      className="absolute -mt-5 -ml-3 w-6"
    >
      <Spark className="w-full text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
    </motion.div>
  );
}
