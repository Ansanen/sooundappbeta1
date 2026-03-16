import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Search, Users, Sparkles } from 'lucide-react';

const steps = [
  {
    icon: Play,
    title: 'Welcome to Soound',
    desc: 'Listen to music in perfect sync with friends, anywhere.',
    gradient: 'from-blue-500/5',
  },
  {
    icon: Search,
    title: 'Search Any Song',
    desc: 'Full tracks from YouTube. No limits, no previews.',
    gradient: 'from-purple-500/5',
  },
  {
    icon: Users,
    title: 'Invite Friends',
    desc: 'Share the room code. Everyone hears the same thing, perfectly in sync.',
    gradient: 'from-green-500/5',
  },
  {
    icon: Sparkles,
    title: "You're All Set!",
    desc: 'Play, pause, skip — everyone stays synchronized. Enjoy!',
    gradient: 'from-amber-500/5',
  },
];

function StepVisual({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="relative w-32 h-32 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-white/10 animate-[ping_2s_ease-out_infinite]" />
        <div className="absolute inset-4 rounded-full border border-white/10 animate-[ping_2s_ease-out_0.4s_infinite]" />
        <div className="absolute inset-8 rounded-full border border-white/10 animate-[ping_2s_ease-out_0.8s_infinite]" />
        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <Play className="w-5 h-5 text-white/50 fill-white/50" />
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="w-64 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center px-4 gap-3">
        <Search className="w-4 h-4 text-white/30 shrink-0" />
        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-white/20 animate-[pulse_2s_ease-in-out_infinite]" />
        </div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="flex -space-x-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-full bg-white/5 border-2 border-[#050505] ring-1 ring-white/10 flex items-center justify-center text-white/30"
            style={{ animationDelay: `${i * 0.15}s` }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.07-7.07l-1.41 1.41M8.34 15.66l-1.41 1.41m0-12.14l1.41 1.41m7.32 7.32l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-4">
      {[0,1,2].map(i => (
        <div key={i} className="w-8 h-8 rounded-full bg-white/10 border border-white/20" style={{ animation: `pulse-ring 1.5s ease-in-out ${i*0.3}s infinite` }} />
      ))}
    </div>
  );
}

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [current, setCurrent] = useState(0);
  const [dir, setDir] = useState(1);

  const next = () => {
    if (current === 3) {
      onComplete();
    } else {
      setDir(1);
      setCurrent((c) => c + 1);
    }
  };

  const skip = () => onComplete();

  const Icon = steps[current].icon;

  return (
    <div className="fixed inset-0 z-[60] bg-[#050505] flex flex-col" style={{ minHeight: '100dvh' }}>
      {/* Background gradient */}
      <div className={`absolute inset-0 bg-gradient-to-b ${steps[current].gradient} to-transparent transition-all duration-700`} />

      {/* Skip */}
      <div className="relative z-10 flex justify-end p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {current < 3 && (
          <button
            onClick={skip}
            className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-sm font-display active:bg-white/10 min-h-[44px] min-w-[44px]"
          >
            Skip
          </button>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={current}
            custom={dir}
            initial={{ opacity: 0, x: dir * 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -80 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex flex-col items-center text-center gap-6"
          >
            <StepVisual step={current} />

            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mt-4">
              <Icon className="w-7 h-7 text-white/70" />
            </div>

            <h2 className="font-display font-bold text-2xl text-white">{steps[current].title}</h2>
            <p className="text-white/50 text-base max-w-xs leading-relaxed">{steps[current].desc}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom */}
      <div className="relative z-10 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-6">
        {/* Dots */}
        <div className="flex gap-2 items-center">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === current ? 'w-6 bg-white' : 'w-2 bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Button */}
        <button
          onClick={next}
          className="w-full bg-white text-black font-display font-bold rounded-2xl py-4 text-base hover:scale-[1.02] active:scale-[0.98] transition-transform min-h-[52px]"
        >
          {current === 3 ? 'Get Started' : 'Next'}
        </button>
      </div>
    </div>
  );
}
