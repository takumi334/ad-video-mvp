"use client";

import { motion } from "framer-motion";

type Mode = "eat" | "sing";
type Quality = "minimal" | "improved";

type CharacterEatingLoopProps = {
  mode?: Mode;
  quality?: Quality;
  imageUrl?: string;
  className?: string;
};

const LOOP_SECONDS = 3;

export default function CharacterEatingLoop({
  mode = "eat",
  quality = "improved",
  imageUrl,
  className = "",
}: CharacterEatingLoopProps) {
  const isEat = mode === "eat";
  const isImproved = quality === "improved";

  return (
    <div
      className={[
        "relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-amber-50 to-rose-50 shadow-sm",
        className,
      ].join(" ")}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.9),rgba(255,255,255,0))]" />

      <motion.div
        className="absolute left-1/2 top-[28%] h-[45%] w-[44%] -translate-x-1/2 rounded-[45%] bg-[#ffe0c5] shadow-[inset_0_-8px_16px_rgba(0,0,0,0.06)]"
        animate={isEat ? { y: [0, 3, 0] } : { y: [0, 4, -1, 3, 0] }}
        transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeInOut" }}
      >
        {imageUrl ? (
          <div className="absolute inset-[10%] overflow-hidden rounded-[35%] border border-white/70">
            <img src={imageUrl} alt="character" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="absolute inset-[10%] grid place-items-center rounded-[35%] border border-dashed border-slate-300 bg-white/50 text-[10px] text-slate-500">
            no image
          </div>
        )}

        <div className="absolute left-[24%] top-[32%] h-2 w-2 rounded-full bg-slate-700" />
        <div className="absolute right-[24%] top-[32%] h-2 w-2 rounded-full bg-slate-700" />

        {isEat ? (
          <>
            <motion.div
              className="absolute left-[22%] top-[32%] h-[2px] w-3 rounded-full bg-slate-800"
              animate={{ scaleY: [1, 0.2, 1], opacity: [1, 0.9, 1] }}
              transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute right-[22%] top-[32%] h-[2px] w-3 rounded-full bg-slate-800"
              animate={{ scaleY: [1, 0.2, 1], opacity: [1, 0.9, 1] }}
              transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        ) : (
          <>
            <motion.div
              className="absolute left-[22%] top-[31%] h-[2px] w-3 rounded-full bg-slate-800"
              animate={{ scaleY: [1, 1, 0.2, 1, 1] }}
              transition={{ duration: LOOP_SECONDS, repeat: Infinity, times: [0, 0.42, 0.5, 0.58, 1] }}
            />
            <motion.div
              className="absolute right-[22%] top-[31%] h-[2px] w-3 rounded-full bg-slate-800"
              animate={{ scaleY: [1, 1, 0.2, 1, 1] }}
              transition={{ duration: LOOP_SECONDS, repeat: Infinity, times: [0, 0.42, 0.5, 0.58, 1] }}
            />
          </>
        )}

        <motion.div
          className="absolute left-1/2 top-[53%] h-3 -translate-x-1/2 rounded-b-xl bg-rose-500/90"
          style={{ width: isEat ? 12 : 16 }}
          animate={isEat ? { scaleY: [0.35, 0.95, 0.35] } : { scaleY: [0.35, 1.35, 0.45, 1.2, 0.35] }}
          transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      <motion.div
        className="absolute left-[58%] top-[62%] h-8 w-14 origin-left rounded-full border border-slate-300 bg-slate-100/95"
        animate={
          isEat
            ? { x: [26, 6, 26], y: [6, -12, 6], rotate: [12, -16, 12] }
            : { x: [24, 14, 24], y: [2, -3, 2], rotate: [6, -4, 6] }
        }
        transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute left-[-72px] top-1/2 h-[4px] w-[76px] -translate-y-1/2 rounded-full bg-amber-800" />
      </motion.div>

      {isEat && (
        <>
          <motion.div
            className="absolute left-[52%] top-[14%] h-7 w-7 rounded-full bg-white/70 blur-[1px]"
            animate={{ y: [12, -18], x: [0, 3], opacity: [0, isImproved ? 0.75 : 0.45, 0] }}
            transition={{ duration: LOOP_SECONDS, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute left-[47%] top-[18%] h-5 w-5 rounded-full bg-white/65 blur-[1px]"
            animate={{ y: [8, -14], x: [0, -2], opacity: [0, isImproved ? 0.7 : 0.4, 0] }}
            transition={{ duration: LOOP_SECONDS, repeat: Infinity, delay: 0.3, ease: "easeOut" }}
          />
        </>
      )}

      {isImproved && <div className="absolute inset-x-6 bottom-4 h-2 rounded-full bg-black/10 blur-sm" />}
    </div>
  );
}
