/**
 * Audio Decoding Utilities
 * 
 * Decode compressed audio to PCM using Web Audio API.
 */

/**
 * Decode audio from ArrayBuffer to AudioBuffer
 */
export async function decodeAudio(
  audioContext: AudioContext | OfflineAudioContext,
  data: ArrayBuffer
): Promise<AudioBuffer> {
  return audioContext.decodeAudioData(data.slice(0));
}

/**
 * Decode audio from URL
 */
export async function decodeAudioFromUrl(
  audioContext: AudioContext | OfflineAudioContext,
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return decodeAudio(audioContext, arrayBuffer);
}

/**
 * Convert AudioBuffer to interleaved Float32Array
 */
export function audioBufferToFloat32(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const output = new Float32Array(length * channels);
  
  // Get channel data
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }
  
  // Interleave
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      output[i * channels + ch] = channelData[ch][i];
    }
  }
  
  return output;
}

/**
 * Convert mono AudioBuffer to stereo interleaved Float32Array
 */
export function monoToStereo(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const output = new Float32Array(length * 2);
  const mono = buffer.getChannelData(0);
  
  for (let i = 0; i < length; i++) {
    output[i * 2] = mono[i];
    output[i * 2 + 1] = mono[i];
  }
  
  return output;
}

/**
 * Resample audio using OfflineAudioContext
 */
export async function resampleAudio(
  buffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetSampleRate) {
    return buffer;
  }
  
  const duration = buffer.duration;
  const targetLength = Math.ceil(duration * targetSampleRate);
  
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    targetLength,
    targetSampleRate
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  return offlineCtx.startRendering();
}

/**
 * Create an AudioBuffer from interleaved Float32Array
 */
export function float32ToAudioBuffer(
  audioContext: AudioContext | OfflineAudioContext,
  samples: Float32Array,
  sampleRate: number,
  channels: number = 2
): AudioBuffer {
  const length = samples.length / channels;
  const buffer = audioContext.createBuffer(channels, length, sampleRate);
  
  for (let ch = 0; ch < channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      channelData[i] = samples[i * channels + ch];
    }
  }
  
  return buffer;
}

/**
 * Calculate RMS volume of audio samples
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Calculate peak volume of audio samples
 */
export function calculatePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}
