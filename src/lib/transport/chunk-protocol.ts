/**
 * Audio Chunk Protocol
 * 
 * Binary format for efficient audio transport:
 * | seq (4 bytes) | timestamp (8 bytes) | length (4 bytes) | pcm_data (variable) |
 * 
 * Total header: 16 bytes
 */

export interface AudioChunk {
  seq: number;         // Sequence number (32-bit unsigned)
  timestamp: number;   // Server timestamp when chunk was generated (64-bit float)
  data: Float32Array;  // PCM audio data
}

export const CHUNK_HEADER_SIZE = 16;

/**
 * Encode an audio chunk to binary format
 */
export function encodeChunk(chunk: AudioChunk): ArrayBuffer {
  const dataBytes = chunk.data.length * 4; // Float32 = 4 bytes
  const buffer = new ArrayBuffer(CHUNK_HEADER_SIZE + dataBytes);
  const view = new DataView(buffer);
  
  // Write header
  view.setUint32(0, chunk.seq, true);      // Little-endian
  view.setFloat64(4, chunk.timestamp, true);
  view.setUint32(12, chunk.data.length, true);
  
  // Write PCM data
  const floatView = new Float32Array(buffer, CHUNK_HEADER_SIZE);
  floatView.set(chunk.data);
  
  return buffer;
}

/**
 * Decode binary data to audio chunk
 */
export function decodeChunk(buffer: ArrayBuffer): AudioChunk {
  if (buffer.byteLength < CHUNK_HEADER_SIZE) {
    throw new Error('Buffer too small for chunk header');
  }
  
  const view = new DataView(buffer);
  
  const seq = view.getUint32(0, true);
  const timestamp = view.getFloat64(4, true);
  const length = view.getUint32(12, true);
  
  const expectedSize = CHUNK_HEADER_SIZE + length * 4;
  if (buffer.byteLength < expectedSize) {
    throw new Error(`Buffer too small: expected ${expectedSize}, got ${buffer.byteLength}`);
  }
  
  const data = new Float32Array(buffer, CHUNK_HEADER_SIZE, length);
  
  return { seq, timestamp, data };
}

/**
 * Create audio chunks from a buffer of samples
 * @param samples Full audio buffer
 * @param sampleRate Sample rate (e.g., 48000)
 * @param chunkDurationMs Duration of each chunk in ms (default 20ms)
 * @param startTime Server timestamp for first chunk
 */
export function createChunks(
  samples: Float32Array,
  sampleRate: number,
  chunkDurationMs: number = 20,
  startTime: number = Date.now()
): AudioChunk[] {
  const samplesPerChunk = Math.floor(sampleRate * chunkDurationMs / 1000);
  const chunks: AudioChunk[] = [];
  
  let offset = 0;
  let seq = 0;
  let timestamp = startTime;
  
  while (offset < samples.length) {
    const end = Math.min(offset + samplesPerChunk, samples.length);
    const data = samples.slice(offset, end);
    
    chunks.push({
      seq: seq++,
      timestamp,
      data
    });
    
    offset = end;
    timestamp += chunkDurationMs;
  }
  
  return chunks;
}

/**
 * Reassemble chunks into contiguous audio buffer
 * Handles out-of-order delivery by sorting by sequence number
 */
export function reassembleChunks(chunks: AudioChunk[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  
  // Sort by sequence number
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  
  // Calculate total length
  const totalLength = sorted.reduce((sum, c) => sum + c.data.length, 0);
  const result = new Float32Array(totalLength);
  
  let offset = 0;
  for (const chunk of sorted) {
    result.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  
  return result;
}
