/**
 * SyncProcessor — AudioWorklet for phase-coherent playback
 * 
 * This processor reads from a SharedArrayBuffer ring buffer,
 * applies drift correction via resampling, and outputs audio
 * synchronized to a global clock.
 */

// Ring buffer header layout
const RING_HEADER_SIZE = 16;  // 4 x Uint32

interface SyncProcessorOptions {
  processorOptions: {
    sharedBuffer: SharedArrayBuffer;
    sampleRate: number;
    channels: number;
  };
}

class SyncProcessor extends AudioWorkletProcessor {
  // Ring buffer
  private header: Uint32Array;
  private data: Float32Array;
  private bufferLength: number;
  private channels: number;
  
  // Timing
  private globalStartTime: number = 0;  // Server time when playback should start
  private localStartTime: number = 0;   // Local time corresponding to globalStartTime
  private manualOffset: number = 0;     // User calibration offset
  private outputLatency: number = 0;    // Estimated output latency
  private samplesPlayed: number = 0;
  private isPlaying: boolean = false;
  
  // Drift correction
  private currentRatio: number = 1.0;
  private fractionalIndex: number = 0;
  
  // Stats
  private lastDrift: number = 0;
  private reportCounter: number = 0;
  
  constructor(options: SyncProcessorOptions) {
    super();
    
    const { sharedBuffer, channels } = options.processorOptions;
    
    // Set up ring buffer views
    this.header = new Uint32Array(sharedBuffer, 0, 4);
    this.data = new Float32Array(sharedBuffer, RING_HEADER_SIZE);
    this.bufferLength = this.header[2];
    this.channels = channels || 2;
    
    // Handle messages from main thread
    this.port.onmessage = (event) => this.handleMessage(event.data);
    
    // Report ready
    this.port.postMessage({ type: 'ready' });
  }
  
  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'start':
        // Start synchronized playback
        this.globalStartTime = msg.globalStartTime;
        this.localStartTime = msg.localStartTime;
        this.manualOffset = msg.manualOffset || 0;
        this.outputLatency = msg.outputLatency || 0;
        this.samplesPlayed = msg.startPosition * sampleRate || 0;
        this.isPlaying = true;
        this.currentRatio = 1.0;
        this.fractionalIndex = 0;
        break;
        
      case 'stop':
        this.isPlaying = false;
        break;
        
      case 'seek':
        this.samplesPlayed = msg.position * sampleRate;
        this.fractionalIndex = 0;
        break;
        
      case 'set_offset':
        this.manualOffset = msg.offset;
        break;
        
      case 'set_latency':
        this.outputLatency = msg.latency;
        break;
    }
  }
  
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }
    
    const outputL = output[0];
    const outputR = output[1] || output[0];
    const frameCount = outputL.length;
    
    if (!this.isPlaying) {
      // Output silence when not playing
      outputL.fill(0);
      if (output[1]) outputR.fill(0);
      return true;
    }
    
    // Calculate drift
    const drift = this.calculateDrift();
    this.lastDrift = drift;
    
    // Calculate resampling ratio
    this.currentRatio = this.driftToRatio(drift);
    
    // Check for hard reset condition
    if (Math.abs(drift) > 0.1) {  // 100ms
      this.hardReset();
      return true;
    }
    
    // Read and resample audio
    const samplesNeeded = Math.ceil(frameCount * this.currentRatio);
    const readBuffer = new Float32Array(samplesNeeded * this.channels);
    const samplesRead = this.readFromRingBuffer(readBuffer, samplesNeeded);
    
    if (samplesRead === 0) {
      // Buffer underrun - output silence
      outputL.fill(0);
      if (output[1]) outputR.fill(0);
      this.port.postMessage({ type: 'underrun' });
      return true;
    }
    
    // Apply resampling with linear interpolation
    this.resample(readBuffer, samplesRead, outputL, outputR, frameCount);
    
    // Update samples played
    this.samplesPlayed += frameCount;
    
    // Report stats periodically
    this.reportCounter++;
    if (this.reportCounter >= 100) {  // ~232ms at 44.1kHz
      this.reportCounter = 0;
      this.port.postMessage({
        type: 'stats',
        drift: this.lastDrift * 1000,  // ms
        ratio: this.currentRatio,
        buffered: this.getBufferedSamples() / sampleRate,
        samplesPlayed: this.samplesPlayed
      });
    }
    
    return true;
  }
  
  private calculateDrift(): number {
    // Calculate where we should be in the track
    const now = performance.timeOrigin + performance.now();
    const elapsed = (now - this.localStartTime - this.manualOffset - this.outputLatency) / 1000;
    const idealPosition = elapsed;
    
    // Calculate where we actually are
    const actualPosition = this.samplesPlayed / sampleRate;
    
    // Drift = actual - ideal
    // Positive = ahead (need to slow down)
    // Negative = behind (need to speed up)
    return actualPosition - idealPosition;
  }
  
  private driftToRatio(drift: number): number {
    // 5ms deadband - don't correct tiny drifts
    if (Math.abs(drift) < 0.005) {
      return 1.0;
    }
    
    // Proportional correction
    // Adjust 10% of drift per second
    const correction = -drift * 0.1;
    
    // Clamp to ±3% to avoid artifacts
    return Math.max(0.97, Math.min(1.03, 1.0 + correction));
  }
  
  private hardReset(): void {
    // Seek ring buffer to ideal position
    const now = performance.timeOrigin + performance.now();
    const elapsed = (now - this.localStartTime - this.manualOffset - this.outputLatency) / 1000;
    
    // Update our position to match ideal
    this.samplesPlayed = elapsed * sampleRate;
    this.fractionalIndex = 0;
    this.currentRatio = 1.0;
    
    // Reset ring buffer read position
    const readPtr = Math.floor(this.samplesPlayed) % this.bufferLength;
    Atomics.store(this.header, 1, readPtr);
    
    this.port.postMessage({ type: 'hard_reset', drift: this.lastDrift * 1000 });
  }
  
  private readFromRingBuffer(output: Float32Array, samples: number): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    
    // Calculate available
    let available: number;
    if (writePtr >= readPtr) {
      available = writePtr - readPtr;
    } else {
      available = this.bufferLength - readPtr + writePtr;
    }
    
    const toRead = Math.min(samples, available);
    
    if (toRead === 0) {
      return 0;
    }
    
    // Read samples
    for (let i = 0; i < toRead; i++) {
      const bufIdx = ((readPtr + i) % this.bufferLength) * this.channels;
      const outIdx = i * this.channels;
      
      for (let ch = 0; ch < this.channels; ch++) {
        output[outIdx + ch] = this.data[bufIdx + ch];
      }
    }
    
    // Update read pointer
    Atomics.store(this.header, 1, (readPtr + toRead) % this.bufferLength);
    
    return toRead;
  }
  
  private getBufferedSamples(): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    
    if (writePtr >= readPtr) {
      return writePtr - readPtr;
    }
    return this.bufferLength - readPtr + writePtr;
  }
  
  private resample(
    input: Float32Array, 
    inputSamples: number,
    outputL: Float32Array, 
    outputR: Float32Array,
    outputFrames: number
  ): void {
    for (let i = 0; i < outputFrames; i++) {
      const srcIdx = i * this.currentRatio + this.fractionalIndex;
      const srcIdxInt = Math.floor(srcIdx);
      const frac = srcIdx - srcIdxInt;
      
      if (srcIdxInt + 1 >= inputSamples) {
        // Ran out of input samples
        outputL[i] = 0;
        outputR[i] = 0;
        continue;
      }
      
      // Linear interpolation
      const idx0 = srcIdxInt * this.channels;
      const idx1 = (srcIdxInt + 1) * this.channels;
      
      outputL[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
      outputR[i] = input[idx0 + 1] * (1 - frac) + input[idx1 + 1] * frac;
    }
    
    // Save fractional part for continuity
    this.fractionalIndex = (this.fractionalIndex + outputFrames * this.currentRatio) % 1;
  }
}

registerProcessor('sync-processor', SyncProcessor);
