/**
 * Pitch-Preserving Resampler
 * 
 * High-quality resampling using libsamplerate WASM.
 * Used for drift correction without affecting pitch.
 */

import { loadResampler, ResamplerHandle, SRC_SINC_FASTEST, SRC_SINC_MEDIUM_QUALITY, SRC_SINC_BEST_QUALITY } from '../worklets/wasm/resampler-loader';

export type ResamplerQuality = 'fast' | 'medium' | 'best';

const QUALITY_MAP: Record<ResamplerQuality, number> = {
  fast: SRC_SINC_FASTEST,
  medium: SRC_SINC_MEDIUM_QUALITY,
  best: SRC_SINC_BEST_QUALITY
};

export class PitchPreservingResampler {
  private handle: ResamplerHandle | null = null;
  private initPromise: Promise<void> | null = null;
  private channels: number;
  private quality: ResamplerQuality;
  private currentRatio = 1.0;
  
  // Ratio limits to prevent artifacts (±3%)
  private static readonly MIN_RATIO = 0.97;
  private static readonly MAX_RATIO = 1.03;
  
  constructor(channels: number = 2, quality: ResamplerQuality = 'fast') {
    this.channels = channels;
    this.quality = quality;
  }
  
  /**
   * Initialize the resampler (must be called before processing)
   */
  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = (async () => {
      const module = await loadResampler();
      this.handle = module.create(this.channels, QUALITY_MAP[this.quality]);
    })();
    
    return this.initPromise;
  }
  
  /**
   * Set the resampling ratio
   * ratio < 1.0 = slow down (stretch)
   * ratio > 1.0 = speed up (compress)
   */
  setRatio(ratio: number): void {
    this.currentRatio = Math.max(
      PitchPreservingResampler.MIN_RATIO,
      Math.min(PitchPreservingResampler.MAX_RATIO, ratio)
    );
  }
  
  /**
   * Get the current resampling ratio
   */
  getRatio(): number {
    return this.currentRatio;
  }
  
  /**
   * Process audio samples
   * @param input Interleaved audio samples
   * @returns Resampled audio samples
   */
  process(input: Float32Array): Float32Array {
    if (!this.handle) {
      // Not initialized, return input unchanged
      return input;
    }
    
    if (Math.abs(this.currentRatio - 1.0) < 0.001) {
      // No resampling needed
      return input;
    }
    
    return this.handle.process(input, this.currentRatio);
  }
  
  /**
   * Reset the resampler state
   */
  reset(): void {
    if (this.handle) {
      this.handle.reset();
    }
    this.currentRatio = 1.0;
  }
  
  /**
   * Destroy the resampler and free resources
   */
  destroy(): void {
    if (this.handle) {
      this.handle.destroy();
      this.handle = null;
    }
    this.initPromise = null;
  }
  
  /**
   * Check if resampler is initialized
   */
  isReady(): boolean {
    return this.handle !== null;
  }
}

/**
 * Simple linear interpolation resampler (fallback, lower quality)
 * Used when WASM is not available or in AudioWorklet
 */
export class LinearResampler {
  private channels: number;
  private currentRatio = 1.0;
  private fractionalIndex = 0;
  
  constructor(channels: number = 2) {
    this.channels = channels;
  }
  
  setRatio(ratio: number): void {
    this.currentRatio = Math.max(0.97, Math.min(1.03, ratio));
  }
  
  getRatio(): number {
    return this.currentRatio;
  }
  
  process(input: Float32Array): Float32Array {
    if (Math.abs(this.currentRatio - 1.0) < 0.001) {
      return input;
    }
    
    const inputSamples = input.length / this.channels;
    const outputSamples = Math.floor(inputSamples / this.currentRatio);
    const output = new Float32Array(outputSamples * this.channels);
    
    for (let i = 0; i < outputSamples; i++) {
      const srcIdx = i * this.currentRatio + this.fractionalIndex;
      const srcIdxInt = Math.floor(srcIdx);
      const frac = srcIdx - srcIdxInt;
      
      if (srcIdxInt + 1 >= inputSamples) break;
      
      for (let ch = 0; ch < this.channels; ch++) {
        const idx0 = srcIdxInt * this.channels + ch;
        const idx1 = (srcIdxInt + 1) * this.channels + ch;
        
        // Linear interpolation
        output[i * this.channels + ch] = 
          input[idx0] * (1 - frac) + input[idx1] * frac;
      }
    }
    
    // Save fractional part for next call
    this.fractionalIndex = (this.fractionalIndex + inputSamples) % 1;
    
    return output;
  }
  
  reset(): void {
    this.currentRatio = 1.0;
    this.fractionalIndex = 0;
  }
}
