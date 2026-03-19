/**
 * WASM Resampler Loader
 * 
 * Loads libsamplerate WASM module for use in main thread or AudioWorklet.
 * 
 * Note: For AudioWorklet, the WASM module must be loaded differently
 * since importScripts and dynamic imports work differently in worklets.
 */

// Quality constants from libsamplerate
export const SRC_SINC_BEST_QUALITY = 0;
export const SRC_SINC_MEDIUM_QUALITY = 1;
export const SRC_SINC_FASTEST = 2;
export const SRC_ZERO_ORDER_HOLD = 3;
export const SRC_LINEAR = 4;

export interface ResamplerModule {
  create(channels: number, quality: number): ResamplerHandle;
}

export interface ResamplerHandle {
  process(input: Float32Array, ratio: number): Float32Array;
  reset(): void;
  destroy(): void;
}

let modulePromise: Promise<ResamplerModule> | null = null;

/**
 * Load the libsamplerate WASM module
 */
export async function loadResampler(): Promise<ResamplerModule> {
  if (modulePromise) {
    return modulePromise;
  }
  
  modulePromise = (async () => {
    // Dynamic import of the library
    const lib = await import('@alexanderolsen/libsamplerate-js');
    
    // Initialize the module
    await lib.create(1, SRC_SINC_FASTEST); // Warm up
    
    return {
      create(channels: number, quality: number = SRC_SINC_FASTEST): ResamplerHandle {
        const resampler = lib.create(channels, quality);
        
        return {
          process(input: Float32Array, ratio: number): Float32Array {
            return resampler.simple(input, ratio);
          },
          
          reset(): void {
            resampler.reset();
          },
          
          destroy(): void {
            resampler.destroy();
          }
        };
      }
    };
  })();
  
  return modulePromise;
}

/**
 * Check if WASM resampling is available
 */
export function isWasmResamplingAvailable(): boolean {
  return typeof WebAssembly !== 'undefined';
}
