/**
 * Drift Calculator
 * 
 * Monitors and calculates playback drift for phase-coherent sync.
 * Used to determine resampling ratio for drift correction.
 */

export interface DriftState {
  driftMs: number;           // Current drift in milliseconds (+ = ahead, - = behind)
  correctionRatio: number;   // Recommended resampling ratio
  isStable: boolean;         // True if drift is within acceptable range
  needsReset: boolean;       // True if hard reset is recommended
}

export interface DriftCalculatorOptions {
  targetDriftMs?: number;    // Target drift (default: 0)
  deadbandMs?: number;       // Deadband - don't correct if drift is smaller (default: 5)
  maxDriftMs?: number;       // Max drift before hard reset (default: 100)
  maxCorrectionRatio?: number; // Max correction (default: 0.03 = 3%)
  smoothingFactor?: number;   // Exponential smoothing (default: 0.1)
}

export class DriftCalculator {
  private targetDriftMs: number;
  private deadbandMs: number;
  private maxDriftMs: number;
  private maxCorrectionRatio: number;
  private smoothingFactor: number;
  
  private smoothedDrift: number = 0;
  private samples: number[] = [];
  private maxSamples = 50;
  
  constructor(options: DriftCalculatorOptions = {}) {
    this.targetDriftMs = options.targetDriftMs ?? 0;
    this.deadbandMs = options.deadbandMs ?? 5;
    this.maxDriftMs = options.maxDriftMs ?? 100;
    this.maxCorrectionRatio = options.maxCorrectionRatio ?? 0.03;
    this.smoothingFactor = options.smoothingFactor ?? 0.1;
  }
  
  /**
   * Update with a new drift measurement
   * @param actualPositionMs Current playback position in ms
   * @param idealPositionMs Where playback should be in ms
   * @returns Updated drift state
   */
  update(actualPositionMs: number, idealPositionMs: number): DriftState {
    const rawDrift = actualPositionMs - idealPositionMs;
    
    // Store sample for variance calculation
    this.samples.push(rawDrift);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    
    // Exponential smoothing
    this.smoothedDrift = this.smoothedDrift * (1 - this.smoothingFactor) + rawDrift * this.smoothingFactor;
    
    return this.getState();
  }
  
  /**
   * Get current drift state
   */
  getState(): DriftState {
    const drift = this.smoothedDrift - this.targetDriftMs;
    
    // Check if reset is needed
    if (Math.abs(drift) > this.maxDriftMs) {
      return {
        driftMs: drift,
        correctionRatio: 1.0,
        isStable: false,
        needsReset: true
      };
    }
    
    // Calculate correction ratio
    let correctionRatio = 1.0;
    
    if (Math.abs(drift) > this.deadbandMs) {
      // Proportional correction
      // Negative drift (behind) → ratio > 1 (speed up)
      // Positive drift (ahead) → ratio < 1 (slow down)
      const correction = -drift / 1000 * 0.1; // 10% correction per second of drift
      correctionRatio = 1.0 + Math.max(-this.maxCorrectionRatio, Math.min(this.maxCorrectionRatio, correction));
    }
    
    return {
      driftMs: drift,
      correctionRatio,
      isStable: Math.abs(drift) < this.deadbandMs,
      needsReset: false
    };
  }
  
  /**
   * Get drift variance (for stability assessment)
   */
  getVariance(): number {
    if (this.samples.length < 2) return 0;
    
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const variance = this.samples.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / this.samples.length;
    
    return variance;
  }
  
  /**
   * Get drift standard deviation
   */
  getStdDev(): number {
    return Math.sqrt(this.getVariance());
  }
  
  /**
   * Reset the calculator
   */
  reset(): void {
    this.smoothedDrift = 0;
    this.samples = [];
  }
  
  /**
   * Set a new target drift
   */
  setTarget(targetMs: number): void {
    this.targetDriftMs = targetMs;
  }
}

/**
 * Calculate ideal playback position based on start time
 * @param startTimeMs Server timestamp when playback started
 * @param clockOffset Local clock offset (local + offset = server)
 * @param outputLatencyMs Audio output latency
 */
export function calculateIdealPosition(
  startTimeMs: number,
  clockOffset: number,
  outputLatencyMs: number = 0
): number {
  const now = performance.timeOrigin + performance.now();
  const serverNow = now + clockOffset;
  const elapsed = serverNow - startTimeMs;
  
  // Subtract output latency since we need to send audio earlier
  return Math.max(0, elapsed - outputLatencyMs);
}

/**
 * Convert AudioContext time to server time
 */
export function audioContextToServerTime(
  contextTime: number,
  contextStartTime: number,
  serverStartTime: number
): number {
  const elapsed = contextTime - contextStartTime;
  return serverStartTime + elapsed * 1000;
}
