"use client";

import { motion, type MotionValue } from "motion/react";

// Vector trace of the brand mark: the "2"-swoosh body and the four-point sparkle.
export const BODY =
  "M278,494 C380,390 520,280 625,285 C670,288 700,330 697,390 C690,520 560,680 430,818 C560,730 680,685 770,688 C880,692 955,790 967,935 L672,935 C675,860 650,805 585,803 C500,802 420,860 348,935 L285,935 C390,800 470,640 495,500 C505,440 490,400 445,398 C390,396 330,440 278,494 Z";
export const SPARK =
  "M900,322 C904,400 905,440 912,460 C920,475 940,478 975,481 C940,485 920,488 912,502 C905,522 904,560 900,648 C896,560 895,522 888,502 C880,488 860,485 825,481 C860,478 880,475 888,460 C895,440 896,400 900,322 Z";

export function Spark({ className }: { className?: string }) {
  return (
    <svg viewBox="820 318 160 334" className={className} aria-hidden>
      <path d={SPARK} fill="currentColor" />
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="250 270 750 690" className={className} aria-hidden>
      <path d={BODY} fill="currentColor" />
      <path d={SPARK} fill="currentColor" />
    </svg>
  );
}

/** Hero mark: sketched stroke draws in, then ink floods it; the sparkle spins with scroll. */
export function DrawnLogo({ className, sparkRotate }: { className?: string; sparkRotate?: MotionValue<number> }) {
  return (
    <svg viewBox="250 270 750 690" className={className} aria-hidden>
      <defs>
        <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="14" stroke="white" strokeWidth="2.5" />
        </pattern>
      </defs>
      {/* offset pencil ghosts */}
      {[[-6, 4], [5, -3]].map(([dx, dy], i) => (
        <motion.path
          key={i}
          d={BODY}
          fill="none"
          stroke="white"
          strokeOpacity={0.35}
          strokeWidth={1.5}
          transform={`translate(${dx} ${dy})`}
          style={{ filter: "url(#rough)" }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.2, delay: 0.25 * i, ease: [0.65, 0, 0.35, 1] }}
        />
      ))}
      <motion.path
        d={BODY}
        fill="url(#hatch)"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.9, 0] }}
        transition={{ duration: 1.6, delay: 1.4, times: [0, 0.4, 1] }}
      />
      <motion.path
        d={BODY}
        stroke="white"
        strokeWidth={4}
        style={{ filter: "url(#rough)" }}
        initial={{ pathLength: 0, fill: "rgba(255,255,255,0)" }}
        animate={{ pathLength: 1, fill: "rgba(255,255,255,1)" }}
        transition={{ pathLength: { duration: 2, ease: [0.65, 0, 0.35, 1] }, fill: { duration: 0.8, delay: 2.2 } }}
      />
      <motion.g
        style={{ rotate: sparkRotate, originX: "900px", originY: "485px", transformBox: "view-box" }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1], opacity: 1 }}
        transition={{ duration: 0.7, delay: 2.4, ease: "easeOut" }}
      >
        <path d={SPARK} fill="white" />
      </motion.g>
    </svg>
  );
}

/** Global wobble filter; the seed steps so every sketched line "boils" like hand-drawn animation. */
export function RoughFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="rough">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="1" result="n">
          <animate attributeName="seed" values="1;2;3;4" dur="0.5s" repeatCount="indefinite" calcMode="discrete" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="3" />
      </filter>
    </svg>
  );
}
