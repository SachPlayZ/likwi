"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DrawnLogo, LogoMark, RoughFilter, Spark } from "./Logo";
import { HfChart } from "./HfChart";

const ease = [0.22, 1, 0.36, 1] as const;

export function Landing() {
  return (
    <main className="relative overflow-x-clip font-sans">
      <RoughFilter />
      <Nav />
      <Hero />
      <Marquee />
      <HfChart />
      <HowItWorks />
      <Manifesto />
      <Cta />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.2, ease }}
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 mix-blend-difference md:px-10"
    >
      <Link href="/" className="flex items-center gap-2.5">
        <LogoMark className="h-7 w-7 text-white" />
        <span className="font-serif text-xl">Liquidation Shield</span>
      </Link>
      <nav className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link href="/demo">Live demo</Link>
        </Button>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/app">
            Launch app <ArrowUpRight />
          </Link>
        </Button>
      </nav>
    </motion.header>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const logoY = useTransform(scrollYProgress, [0, 1], [0, 260]);
  const logoScale = useTransform(scrollYProgress, [0, 1], [1, 0.7]);
  const sparkRotate = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section ref={ref} className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-24">
      <SketchCircle />
      <motion.div style={{ y: logoY, scale: logoScale }} className="relative w-[min(56vw,340px)]">
        <DrawnLogo className="w-full" sparkRotate={sparkRotate} />
        <motion.span
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 2.8, duration: 0.6 }}
          className="absolute -right-28 top-2 hidden rotate-6 font-hand text-2xl text-muted-foreground md:block"
        >
          ← every block
        </motion.span>
      </motion.div>

      <motion.div style={{ y: textY, opacity: fade }} className="relative mt-12 max-w-4xl text-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          <Badge variant="outline" className="mb-6 rounded-full border-white/30 px-3 py-1 font-mono text-[11px] tracking-widest uppercase">
            Aave V3 · Monad · 0.3s blocks
          </Badge>
        </motion.div>
        <h1 className="font-serif text-6xl leading-[0.95] tracking-tight md:text-8xl">
          <Reveal text="Liquidation is" delay={0.6} />
          <br />
          <em className="text-muted-foreground">
            <Reveal text="a choice." delay={0.95} />
          </em>
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.8, ease }}
          className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground"
        >
          A non-custodial Shield that deleverages your Position with a flash loan, gradually, block by block — before
          anyone else gets to.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.8, ease }}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          <Button asChild size="lg" className="rounded-full">
            <Link href="/app">
              Shield a loan <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full border-white/30 bg-transparent">
            <Link href="/demo">Watch the crash</Link>
          </Button>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 3 }}
        className="absolute bottom-8 flex flex-col items-center gap-2 font-hand text-xl text-muted-foreground"
      >
        scroll
        <motion.svg width="16" height="40" viewBox="0 0 16 40" animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
          <path d="M8 2 C 7 14, 9 24, 8 36 M2 30 L8 37 L14 30" stroke="white" strokeWidth="1.5" fill="none" style={{ filter: "url(#rough)" }} />
        </motion.svg>
      </motion.div>
    </section>
  );
}

function SketchCircle() {
  return (
    <svg viewBox="0 0 800 800" className="pointer-events-none absolute top-1/2 left-1/2 w-[min(110vw,900px)] -translate-x-1/2 -translate-y-1/2 opacity-30" aria-hidden>
      {[0, 1].map((i) => (
        <motion.ellipse
          key={i}
          cx={400 + i * 6}
          cy={400 - i * 4}
          rx={330 - i * 14}
          ry={310 + i * 10}
          fill="none"
          stroke="white"
          strokeWidth={1.2}
          style={{ filter: "url(#rough)" }}
          initial={{ pathLength: 0, rotate: -20 + i * 30 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.6, delay: 0.4 + i * 0.3, ease: [0.65, 0, 0.35, 1] }}
        />
      ))}
    </svg>
  );
}

function Reveal({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-2 align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.9, delay: delay + i * 0.08, ease }}
          >
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </>
  );
}

function Marquee() {
  const items = ["protect(user)", "every block", "non-custodial", "flash-loan deleverage", "permissionless", "no funds held"];
  const row = [...items, ...items];
  return (
    <div className="relative -rotate-2 border-y border-white/20 bg-white py-3 text-black">
      <motion.div
        className="flex w-max gap-8 font-serif text-3xl whitespace-nowrap italic"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ repeat: Infinity, duration: 22, ease: "linear" }}
      >
        {[...row, ...row].map((t, i) => (
          <span key={i} className="flex items-center gap-8">
            {t} <Spark className="h-6 w-4 text-black" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Set your line",
    body: "Pick a Trigger HF and a Target HF. One signature. Your collateral never leaves Aave.",
    doodle: "M10,60 C40,58 80,62 120,60 M100,45 L122,60 L100,75",
  },
  {
    n: "02",
    title: "Keepers watch",
    body: "Anyone can call protect(user). Keepers check your Health Factor every 0.3s block.",
    doodle: "M15,60 C30,30 90,30 105,60 C90,90 30,90 15,60 Z M60,48 a12,12 0 1,0 0.1,0",
  },
  {
    n: "03",
    title: "Step, don't dump",
    body: "A flash loan repays a slice of debt, pulls matching collateral, swaps it back. HF strictly rises — or it reverts.",
    doodle: "M10,90 L40,90 L40,65 L70,65 L70,40 L100,40 L100,15 L125,15",
  },
];

function HowItWorks() {
  return (
    <section className="px-6 py-32 md:px-16">
      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="font-hand text-2xl text-muted-foreground"
      >
        how it works
      </motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease }}
        className="max-w-3xl font-serif text-5xl md:text-7xl"
      >
        Three moves. <em className="text-muted-foreground">Zero custody.</em>
      </motion.h2>
      <div className="mt-16 grid gap-8 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 60, rotate: i % 2 ? 2 : -2 }}
            whileInView={{ opacity: 1, y: 0, rotate: i % 2 ? 0.6 : -0.6 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: i * 0.12, ease }}
            whileHover={{ rotate: 0, y: -6 }}
            className="sketch-box p-8"
          >
            <svg viewBox="0 0 135 105" className="mb-6 h-20 w-28">
              <motion.path
                d={s.doodle}
                fill="none"
                stroke="white"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: "url(#rough)" }}
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.4, delay: 0.3 + i * 0.15, ease: "easeInOut" }}
              />
            </svg>
            <div className="font-hand text-3xl text-muted-foreground">{s.n}</div>
            <h3 className="mt-1 font-serif text-3xl">{s.title}</h3>
            <p className="mt-3 text-muted-foreground">{s.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const MANIFESTO = "The Shield holds no funds after any call. It repays debt before it touches collateral. Every Step strictly raises your Health Factor, or it reverts.";

function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.4"] });
  const words = MANIFESTO.split(" ");
  return (
    <section className="relative px-6 py-32 md:px-16">
      <Spark className="absolute top-20 right-10 h-24 w-12 text-white/10 md:h-48 md:w-24" />
      <p ref={ref} className="max-w-5xl font-serif text-4xl leading-tight md:text-6xl">
        {words.map((w, i) => (
          <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
            {w}
          </Word>
        ))}
      </p>
    </section>
  );
}

function Word({ children, progress, range }: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.12, 1]);
  return <motion.span style={{ opacity }}>{children} </motion.span>;
}

function Cta() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.6, 1]);
  const rotate = useTransform(scrollYProgress, [0, 1], [-25, 0]);
  return (
    <section ref={ref} className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden bg-white px-6 text-black">
      <motion.div style={{ scale, rotate }} className="pointer-events-none absolute w-[min(130vw,1100px)] opacity-[0.06]">
        <LogoMark className="w-full text-black" />
      </motion.div>
      <p className="relative font-hand text-3xl text-black/50">before the liquidator does —</p>
      <h2 className="relative mt-2 text-center font-serif text-6xl md:text-9xl">
        Shield <em>it.</em>
      </h2>
      <div className="relative mt-10 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg" className="rounded-full bg-black text-white hover:bg-black/85">
          <Link href="/app">
            Launch app <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full border-black/30 bg-transparent text-black hover:bg-black/5">
          <Link href="/demo">Live demo on testnet</Link>
        </Button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="flex flex-col items-center justify-between gap-4 border-t border-white/10 px-6 py-10 font-mono text-xs text-muted-foreground md:flex-row md:px-16">
      <div className="flex items-center gap-2">
        <LogoMark className="h-5 w-5 text-white" /> Liquidation Shield · Monad Blitz, DevCon Mumbai
      </div>
      <div>Testnet only. Not audited. Not financial advice.</div>
    </footer>
  );
}
