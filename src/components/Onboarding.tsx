import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Users, Play, CheckCircle2, X } from 'lucide-react';

interface OnboardingProps {
  onComplete: () => void;
}

const STEPS = [
  {
    title: "Welcome to Soound",
    description: "Listen to music in perfect sync with your friends, no matter where they are.",
    icon: <Play className="w-8 h-8 text-blue-400" />,
    target: "player"
  },
  {
    title: "Search Any Song",
    description: "Use the search bar to find millions of tracks. We use iTunes to provide high-quality 30-second previews for testing.",
    icon: <Search className="w-8 h-8 text-violet-400" />,
    target: "search"
  },
  {
    title: "Invite Friends",
    description: "Click the Invite button to copy the room link. Anyone with the link will hear exactly what you hear.",
    icon: <Users className="w-8 h-8 text-emerald-400" />,
    target: "invite"
  },
  {
    title: "You're All Set!",
    description: "Play, pause, or seek the track. Everyone's player will stay perfectly synchronized.",
    icon: <CheckCircle2 className="w-8 h-8 text-blue-400" />,
    target: "done"
  }
];

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep === STEPS.length - 1) {
      onComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          className="bg-white/10 border border-white/20 backdrop-blur-2xl rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden"
        >
          {/* Decorative background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-gradient-to-b from-blue-500/20 to-transparent blur-2xl pointer-events-none" />

          <button 
            onClick={onComplete}
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center space-y-6 relative z-10">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
              {STEPS[currentStep].icon}
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {STEPS[currentStep].title}
              </h2>
              <p className="text-gray-300 leading-relaxed">
                {STEPS[currentStep].description}
              </p>
            </div>

            <div className="flex gap-2 py-4">
              {STEPS.map((_, idx) => (
                <div 
                  key={idx} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === currentStep ? 'w-6 bg-blue-500' : 'w-2 bg-white/20'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              className="w-full py-3.5 px-6 rounded-xl bg-white text-black font-semibold hover:scale-[1.02] transition-transform shadow-lg shadow-white/10"
            >
              {currentStep === STEPS.length - 1 ? "Get Started" : "Next"}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
