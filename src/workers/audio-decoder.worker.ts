/**
 * Audio Decoder Web Worker
 * 
 * Decodes compressed audio chunks off the main thread.
 * Writes decoded PCM to SharedArrayBuffer ring buffer.
 */

import { RingBuffer } from '../lib/audio/ring-buffer';

interface DecodeRequest {
  type: 'init' | 'decode' | 'flush';
  id?: number;
  sharedBuffer?: SharedArrayBuffer;
  sampleRate?: number;
  channels?: number;
  data?: ArrayBuffer;
}

// State
let ringBuffer: RingBuffer | null = null;
let offlineCtx: OfflineAudioContext | null = null;
let targetSampleRate = 48000;
let targetChannels = 2;

// Decode queue
const decodeQueue: Array<{ id: number; data: ArrayBuffer }> = [];
let isDecoding = false;

async function processQueue() {
  if (isDecoding || decodeQueue.length === 0 || !ringBuffer) {
    return;
  }
  
  isDecoding = true;
  
  while (decodeQueue.length > 0) {
    const item = decodeQueue.shift()!;
    
    try {
      await decodeAndWrite(item.id, item.data);
    } catch (error) {
      self.postMessage({
        type: 'decode_error',
        id: item.id,
        error: (error as Error).message
      });
    }
  }
  
  isDecoding = false;
}

async function decodeAndWrite(id: number, data: ArrayBuffer) {
  if (!ringBuffer) {
    throw new Error('Ring buffer not initialized');
  }
  
  // Create offline context for decoding
  // Use a small context - we just need to decode the chunk
  const ctx = new OfflineAudioContext(
    targetChannels,
    targetSampleRate, // At least 1 second capacity
    targetSampleRate
  );
  
  // Decode audio
  const audioBuffer = await ctx.decodeAudioData(data.slice(0));
  
  // Resample if needed
  let finalBuffer = audioBuffer;
  if (audioBuffer.sampleRate !== targetSampleRate) {
    finalBuffer = await resample(audioBuffer, targetSampleRate);
  }
  
  // Convert to interleaved Float32Array
  const samples = audioBufferToFloat32(finalBuffer);
  
  // Write to ring buffer
  const written = ringBuffer.write(samples);
  
  // Report completion
  self.postMessage({
    type: 'decoded',
    id,
    samples: samples.length / targetChannels,
    written,
    buffered: ringBuffer.getBufferedDuration()
  });
}

async function resample(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  const duration = buffer.duration;
  const targetLength = Math.ceil(duration * targetRate);
  
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    targetLength,
    targetRate
  );
  
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  
  return ctx.startRendering();
}

function audioBufferToFloat32(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const output = new Float32Array(length * targetChannels);
  
  // Handle mono to stereo conversion
  if (channels === 1 && targetChannels === 2) {
    const mono = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      output[i * 2] = mono[i];
      output[i * 2 + 1] = mono[i];
    }
  } else {
    // Interleave channels
    for (let ch = 0; ch < Math.min(channels, targetChannels); ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        output[i * targetChannels + ch] = channelData[i];
      }
    }
  }
  
  return output;
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { type, id, sharedBuffer, sampleRate, channels, data } = event.data;
  
  switch (type) {
    case 'init':
      if (!sharedBuffer) {
        self.postMessage({ type: 'error', error: 'No shared buffer provided' });
        return;
      }
      
      ringBuffer = RingBuffer.fromSharedBuffer(sharedBuffer);
      targetSampleRate = sampleRate || 48000;
      targetChannels = channels || 2;
      
      self.postMessage({ type: 'ready' });
      break;
      
    case 'decode':
      if (!data || id === undefined) {
        self.postMessage({ type: 'error', error: 'No data to decode' });
        return;
      }
      
      decodeQueue.push({ id, data });
      processQueue();
      break;
      
    case 'flush':
      decodeQueue.length = 0;
      if (ringBuffer) {
        ringBuffer.clear();
      }
      self.postMessage({ type: 'flushed' });
      break;
  }
};

export {};
