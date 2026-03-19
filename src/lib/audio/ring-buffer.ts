/**
 * Ring Buffer for Audio
 * 
 * Lock-free circular buffer using SharedArrayBuffer for communication
 * between main thread and AudioWorklet.
 * 
 * Memory layout:
 * - [0]: Write pointer (Uint32)
 * - [1]: Read pointer (Uint32)
 * - [2]: Buffer length (Uint32)
 * - [3]: Channels (Uint32)
 * - [4+]: Audio data (Float32)
 */

export const RING_BUFFER_HEADER_SIZE = 16; // 4 x Uint32

export interface RingBufferOptions {
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

export class RingBuffer {
  private sharedBuffer: SharedArrayBuffer;
  private header: Uint32Array;
  private data: Float32Array;
  private sampleRate: number;
  private channels: number;
  private bufferLength: number;
  
  /**
   * Create a new ring buffer
   */
  constructor(options: RingBufferOptions) {
    this.sampleRate = options.sampleRate;
    this.channels = options.channels;
    
    // Calculate buffer size (samples per channel)
    this.bufferLength = Math.ceil(options.sampleRate * options.durationSeconds);
    
    // Total bytes: header + (samples * channels * 4 bytes per float)
    const dataBytes = this.bufferLength * this.channels * 4;
    const totalBytes = RING_BUFFER_HEADER_SIZE + dataBytes;
    
    // Create SharedArrayBuffer
    this.sharedBuffer = new SharedArrayBuffer(totalBytes);
    
    // Create views
    this.header = new Uint32Array(this.sharedBuffer, 0, 4);
    this.data = new Float32Array(this.sharedBuffer, RING_BUFFER_HEADER_SIZE);
    
    // Initialize header
    this.header[0] = 0; // Write pointer
    this.header[1] = 0; // Read pointer
    this.header[2] = this.bufferLength;
    this.header[3] = this.channels;
  }
  
  /**
   * Create from existing SharedArrayBuffer (for AudioWorklet)
   */
  static fromSharedBuffer(buffer: SharedArrayBuffer): RingBuffer {
    const header = new Uint32Array(buffer, 0, 4);
    const bufferLength = header[2];
    const channels = header[3];
    
    const rb = Object.create(RingBuffer.prototype);
    rb.sharedBuffer = buffer;
    rb.header = header;
    rb.data = new Float32Array(buffer, RING_BUFFER_HEADER_SIZE);
    rb.bufferLength = bufferLength;
    rb.channels = channels;
    rb.sampleRate = 48000; // Default, can be updated
    
    return rb;
  }
  
  /**
   * Get the underlying SharedArrayBuffer
   */
  getSharedBuffer(): SharedArrayBuffer {
    return this.sharedBuffer;
  }
  
  /**
   * Write samples to the buffer (interleaved)
   * Returns number of samples actually written
   */
  write(samples: Float32Array): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    
    // Calculate available space
    const available = this.availableWrite(writePtr, readPtr);
    const samplesToWrite = Math.min(samples.length / this.channels, available);
    
    if (samplesToWrite === 0) {
      return 0;
    }
    
    // Write samples
    for (let i = 0; i < samplesToWrite; i++) {
      const bufIdx = ((writePtr + i) % this.bufferLength) * this.channels;
      const srcIdx = i * this.channels;
      
      for (let ch = 0; ch < this.channels; ch++) {
        this.data[bufIdx + ch] = samples[srcIdx + ch];
      }
    }
    
    // Update write pointer atomically
    Atomics.store(this.header, 0, (writePtr + samplesToWrite) % this.bufferLength);
    
    return samplesToWrite;
  }
  
  /**
   * Write mono samples to the buffer
   */
  writeMono(samples: Float32Array): number {
    if (this.channels === 1) {
      return this.write(samples);
    }
    
    // Convert mono to stereo
    const stereo = new Float32Array(samples.length * this.channels);
    for (let i = 0; i < samples.length; i++) {
      for (let ch = 0; ch < this.channels; ch++) {
        stereo[i * this.channels + ch] = samples[i];
      }
    }
    
    return this.write(stereo);
  }
  
  /**
   * Read samples from the buffer (interleaved)
   * Returns number of samples actually read
   */
  read(samples: Float32Array): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    
    // Calculate available data
    const available = this.availableRead(writePtr, readPtr);
    const samplesToRead = Math.min(samples.length / this.channels, available);
    
    if (samplesToRead === 0) {
      // Fill with silence
      samples.fill(0);
      return 0;
    }
    
    // Read samples
    for (let i = 0; i < samplesToRead; i++) {
      const bufIdx = ((readPtr + i) % this.bufferLength) * this.channels;
      const dstIdx = i * this.channels;
      
      for (let ch = 0; ch < this.channels; ch++) {
        samples[dstIdx + ch] = this.data[bufIdx + ch];
      }
    }
    
    // Fill remaining with silence if needed
    const remaining = samples.length / this.channels - samplesToRead;
    if (remaining > 0) {
      samples.fill(0, samplesToRead * this.channels);
    }
    
    // Update read pointer atomically
    Atomics.store(this.header, 1, (readPtr + samplesToRead) % this.bufferLength);
    
    return samplesToRead;
  }
  
  /**
   * Get number of samples available to read
   */
  available(): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    return this.availableRead(writePtr, readPtr);
  }
  
  /**
   * Get number of samples available to write
   */
  space(): number {
    const writePtr = Atomics.load(this.header, 0);
    const readPtr = Atomics.load(this.header, 1);
    return this.availableWrite(writePtr, readPtr);
  }
  
  /**
   * Clear the buffer
   */
  clear(): void {
    Atomics.store(this.header, 0, 0);
    Atomics.store(this.header, 1, 0);
  }
  
  /**
   * Get buffer duration in seconds
   */
  getDuration(): number {
    return this.bufferLength / this.sampleRate;
  }
  
  /**
   * Get buffered duration in seconds
   */
  getBufferedDuration(): number {
    return this.available() / this.sampleRate;
  }
  
  private availableRead(writePtr: number, readPtr: number): number {
    if (writePtr >= readPtr) {
      return writePtr - readPtr;
    }
    return this.bufferLength - readPtr + writePtr;
  }
  
  private availableWrite(writePtr: number, readPtr: number): number {
    // Leave one slot empty to distinguish full from empty
    if (readPtr > writePtr) {
      return readPtr - writePtr - 1;
    }
    return this.bufferLength - writePtr + readPtr - 1;
  }
}

/**
 * Simple non-shared ring buffer for non-worklet use
 */
export class SimpleRingBuffer {
  private buffer: Float32Array;
  private writePtr = 0;
  private readPtr = 0;
  private length: number;
  private channels: number;
  
  constructor(lengthSamples: number, channels = 2) {
    this.length = lengthSamples;
    this.channels = channels;
    this.buffer = new Float32Array(lengthSamples * channels);
  }
  
  write(samples: Float32Array): number {
    const available = this.space();
    const samplesToWrite = Math.min(samples.length / this.channels, available);
    
    for (let i = 0; i < samplesToWrite * this.channels; i++) {
      const idx = (this.writePtr * this.channels + i) % (this.length * this.channels);
      this.buffer[idx] = samples[i];
    }
    
    this.writePtr = (this.writePtr + samplesToWrite) % this.length;
    return samplesToWrite;
  }
  
  read(samples: Float32Array): number {
    const available = this.available();
    const samplesToRead = Math.min(samples.length / this.channels, available);
    
    for (let i = 0; i < samplesToRead * this.channels; i++) {
      const idx = (this.readPtr * this.channels + i) % (this.length * this.channels);
      samples[i] = this.buffer[idx];
    }
    
    // Fill remaining with silence
    for (let i = samplesToRead * this.channels; i < samples.length; i++) {
      samples[i] = 0;
    }
    
    this.readPtr = (this.readPtr + samplesToRead) % this.length;
    return samplesToRead;
  }
  
  available(): number {
    if (this.writePtr >= this.readPtr) {
      return this.writePtr - this.readPtr;
    }
    return this.length - this.readPtr + this.writePtr;
  }
  
  space(): number {
    if (this.readPtr > this.writePtr) {
      return this.readPtr - this.writePtr - 1;
    }
    return this.length - this.writePtr + this.readPtr - 1;
  }
  
  clear(): void {
    this.writePtr = 0;
    this.readPtr = 0;
  }
}
