# Soound — Implementation Tasks
## Phase-Coherent Distributed Audio System

**Reference:** `plan.md`  
**Target:** ≤10ms sync, 50-200 listeners, Safari support, high-quality audio

---

## Phase 0: Infrastructure Setup
**Duration:** 1-2 hours  
**Goal:** Prepare environment for advanced features

### Tasks:
- [x] **0.1** Add COOP/COEP headers to nginx for SharedArrayBuffer
  ```nginx
  add_header Cross-Origin-Embedder-Policy "credentialless" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  ```
- [x] **0.2** Install dependencies
  ```bash
  npm install @alexanderolsen/libsamplerate-js
  ```
- [x] **0.3** Create directory structure
  ```
  src/workers/
  src/worklets/
  src/worklets/wasm/
  src/lib/transport/
  src/lib/sync/
  src/lib/audio/
  ```
- [x] **0.4** Configure Vite for Worker/Worklet bundling
  ```typescript
  // vite.config.ts
  worker: { format: 'es' }
  ```

### Test:
- SharedArrayBuffer available in console: `typeof SharedArrayBuffer !== 'undefined'`

---

## Phase 1: Time Sync Web Worker
**Duration:** 3-4 hours  
**Goal:** Accurate clock synchronization immune to tab throttling

### Tasks:
- [x] **1.1** Create `src/workers/time-sync.worker.ts`
  ```typescript
  // NTP-like intersection algorithm
  // Uses performance.timeOrigin + performance.now()
  // Runs ping rounds every 5s
  // Outputs: { offset, rtt, confidence }
  ```

- [x] **1.2** Implement ping protocol
  - Client sends: `{ type: 'sync_ping', t0: hrtime }`
  - Server responds: `{ type: 'sync_pong', t0, t1, t2 }`
  - Calculate RTT and offset using intersection algorithm

- [x] **1.3** Add server handler in `server.ts`
  ```typescript
  socket.on('sync_ping', (data) => {
    const t1 = getHighResTime();
    // minimal processing
    const t2 = getHighResTime();
    socket.emit('sync_pong', { t0: data.t0, t1, t2 });
  });
  ```

- [x] **1.4** Create `src/lib/sync/clock.ts` — global clock abstraction
  ```typescript
  class GlobalClock {
    getServerTime(): number  // Returns estimated server time
    getOffset(): number      // Current offset
    getRTT(): number        // Current RTT
    toLocalTime(serverTime: number): number
  }
  ```

- [x] **1.5** Create React hook `src/hooks/useGlobalClock.ts`

### Test:
```javascript
// In console, should show offset < 50ms after warmup
console.log('Offset:', globalClock.getOffset(), 'RTT:', globalClock.getRTT());
```

---

## Phase 2: Binary Audio Transport
**Duration:** 4-5 hours  
**Goal:** Efficient audio chunk delivery (WebTransport + WS fallback)

### Tasks:
- [x] **2.1** Create `src/lib/transport/chunk-protocol.ts`
  ```typescript
  // Chunk format: seq(4) + timestamp(8) + length(4) + pcm_data
  interface AudioChunk {
    seq: number;
    timestamp: number;
    data: Float32Array;
  }
  function encodeChunk(chunk: AudioChunk): ArrayBuffer
  function decodeChunk(buffer: ArrayBuffer): AudioChunk
  ```

- [x] **2.2** Create `src/lib/transport/ws-binary.ts` (Safari fallback)
  ```typescript
  class BinaryWSTransport {
    connect(url: string): Promise<void>
    onChunk(callback: (chunk: AudioChunk) => void): void
    close(): void
  }
  ```

- [x] **2.3** Create `src/lib/transport/webtransport.ts`
  ```typescript
  class QuicTransport {
    connect(url: string): Promise<void>
    onDatagram(callback: (data: Uint8Array) => void): void
    // Uses datagrams for audio, stream for control
  }
  ```

- [x] **2.4** Create `src/lib/transport/transport-factory.ts`
  ```typescript
  function createTransport(): BinaryWSTransport | QuicTransport {
    if (typeof WebTransport !== 'undefined') {
      return new QuicTransport();
    }
    return new BinaryWSTransport();
  }
  ```

- [x] **2.5** Server: Add binary streaming endpoint (AudioBroadcaster class)

- [x] **2.6** Server: PCM transcoding pipeline (existing)

### Test:
- Open 2 browser tabs
- Both receive same audio chunks
- Check chunk sequence continuity in console

---

## Phase 3: Ring Buffer & Audio Decoder
**Duration:** 2-3 hours  
**Goal:** Efficient buffer management for AudioWorklet

### Tasks:
- [x] **3.1** Create `src/lib/audio/ring-buffer.ts`
  ```typescript
  // Lock-free ring buffer using SharedArrayBuffer
  class RingBuffer {
    constructor(sampleRate: number, channels: number, seconds: number)
    write(samples: Float32Array): number  // Returns samples written
    read(samples: Float32Array): number   // Returns samples read
    available(): number
    clear(): void
  }
  ```

- [x] **3.2** Create `src/workers/audio-decoder.worker.ts`
  ```typescript
  // Receives compressed chunks
  // Decodes using OfflineAudioContext
  // Writes to SharedArrayBuffer ring buffer
  ```

- [x] **3.3** Created `src/lib/audio/decoder.ts` with utilities

### Test:
- Write 1 second of audio, read back
- Verify no glitches or discontinuities

---

## Phase 4: WASM Resampler
**Duration:** 3-4 hours  
**Goal:** Pitch-preserving drift correction

### Tasks:
- [x] **4.1** Install libsamplerate WASM
  ```bash
  npm install @alexanderolsen/libsamplerate-js
  ```

- [x] **4.2** Create `src/worklets/wasm/resampler-loader.ts`
  ```typescript
  // Load WASM module for use in AudioWorklet
  async function loadResampler(): Promise<ResamplerModule>
  ```

- [x] **4.3** Create resampler wrapper `src/lib/audio/resampler.ts`
  ```typescript
  class PitchPreservingResampler {
    constructor(channels: number, quality: 'fast' | 'medium' | 'best')
    setRatio(ratio: number): void  // 0.97 - 1.03
    process(input: Float32Array): Float32Array
    reset(): void
  }
  ```

- [x] **4.4** Created LinearResampler fallback for AudioWorklet
  - Input 44100Hz sine wave
  - Resample at ratio 1.02
  - Verify pitch unchanged, only duration affected

### Test:
- A/B comparison: original vs resampled
- No audible pitch shift

---

## Phase 5: AudioWorklet Processor
**Duration:** 4-5 hours  
**Goal:** Real-time sync with WASM resampling

### Tasks:
- [x] **5.1** Create `src/worklets/sync-processor.ts`
  ```typescript
  class SyncProcessor extends AudioWorkletProcessor {
    // Reads from ring buffer (SharedArrayBuffer)
    // Uses WASM resampler for drift correction
    // Outputs 128 samples per process() call
    
    process(inputs, outputs, parameters) {
      const drift = this.calculateDrift();
      const ratio = this.driftToRatio(drift);
      this.resampler.setRatio(ratio);
      
      const resampled = this.resampler.process(this.readFromBuffer());
      outputs[0][0].set(resampled);
      return true;
    }
  }
  ```

- [x] **5.2** Implement drift calculation
  ```typescript
  calculateDrift(): number {
    const idealPosition = (this.globalStartTime - this.localStartTime) 
                         + (currentFrame / sampleRate);
    const actualPosition = this.samplesPlayed / sampleRate;
    return actualPosition - idealPosition;  // positive = ahead
  }
  ```

- [x] **5.3** Implement ratio calculation
  ```typescript
  driftToRatio(drift: number): number {
    // Soft correction: adjust ratio proportionally
    // Clamp to ±3% to avoid artifacts
    if (Math.abs(drift) < 0.005) return 1.0;  // 5ms deadband
    const correction = -drift * 0.1;  // 10% of drift per second
    return Math.max(0.97, Math.min(1.03, 1.0 + correction));
  }
  ```

- [x] **5.4** Hard reset logic
  ```typescript
  if (Math.abs(drift) > 0.1) {  // 100ms
    this.hardReset(idealPosition);
  }
  ```

- [x] **5.5** Create `src/hooks/useSyncedAudio.ts`
  ```typescript
  // Main hook combining all components
  function useSyncedAudio(roomId: string) {
    const clock = useGlobalClock();
    const transport = useTransport();
    const worklet = useAudioWorklet();
    
    return {
      play, pause, seek,
      currentTime, duration,
      syncStatus, driftMs
    };
  }
  ```

### Test:
- Open room on 2 devices
- Play audio
- Measure sync with oscilloscope app or by ear
- Should be < 10ms apart

---

## Phase 6: Latency Calibration UI
**Duration:** 1-2 hours  
**Goal:** Manual correction for incorrect hardware latency

### Tasks:
- [x] **6.1** Create `src/components/LatencyCalibration.tsx`
  ```tsx
  // Slider: -100ms to +100ms
  // "Test" button plays click track for user to sync
  // Stores in localStorage: soound_latency_offset
  ```

- [x] **6.2** Integrate offset into AudioWorklet
  ```typescript
  this.manualOffset = parameters.manualOffset[0];
  const adjustedStartTime = this.localStartTime + this.manualOffset;
  ```

- [x] **6.3** Add calibration wizard
  - Play synchronized click
  - User taps when they hear it
  - Calculate and suggest offset

### Test:
- Set +50ms offset
- Verify audio is delayed by 50ms

---

## Phase 7: Server Scalability (50-200 listeners)
**Duration:** 2-3 hours  
**Goal:** Handle high listener counts efficiently

### Tasks:
- [x] **7.1** Implement chunk broadcasting (AudioBroadcaster class in server.ts)
  ```typescript
  // Don't transcode per-client
  // Single transcode → broadcast to all
  class AudioBroadcaster {
    addListener(socket): void
    removeListener(socket): void
    broadcast(chunk: ArrayBuffer): void  // O(n) but efficient
  }
  ```

- [x] **7.2** Connection pooling via Socket.IO rooms
  - Limit concurrent WebTransport sessions
  - Queue excess connections

- [x] **7.3** Backpressure via chunk buffering
  - If client can't keep up, drop chunks
  - Client requests resync if gap detected

- [ ] **7.4** Load test
  ```bash
  # Use k6 or artillery
  # Simulate 200 concurrent listeners
  ```

### Test:
- 100 simulated clients
- Verify server memory/CPU stable
- All clients receive chunks

---

## Phase 8: Integration & Polish
**Duration:** 2-3 hours  
**Goal:** Replace old sync system, final testing

### Tasks:
- [ ] **8.1** Replace `useUnifiedAudio` with `useSyncedAudio`
- [ ] **8.2** Update Room.tsx to use new hook
- [ ] **8.3** Add sync quality indicator to UI
  ```tsx
  <SyncIndicator driftMs={drift} rttMs={rtt} />
  // Green: <10ms, Yellow: 10-50ms, Red: >50ms
  ```
- [ ] **8.4** Error handling & fallbacks
  - If WASM fails → use playbackRate (with pitch warning)
  - If WebTransport fails → auto-switch to WS
- [ ] **8.5** Remove old sync code
- [ ] **8.6** Final cross-device testing

### Test:
- Full E2E test: PC host, iPhone + Android listeners
- Verify sync < 10ms
- Test pause/resume/seek
- Test reconnection

---

## Execution Order

| Phase | Dependencies | Estimated Time |
|-------|-------------|----------------|
| 0 | None | 1-2h |
| 1 | Phase 0 | 3-4h |
| 2 | Phase 1 | 4-5h |
| 3 | Phase 2 | 2-3h |
| 4 | None (parallel) | 3-4h |
| 5 | Phase 3, 4 | 4-5h |
| 6 | Phase 5 | 1-2h |
| 7 | Phase 2 | 2-3h |
| 8 | All | 2-3h |

**Total estimated time:** 22-31 hours

---

## Context Clearing Strategy

After completing each major phase:
1. Update this file (mark tasks [x])
2. Commit changes with descriptive message
3. Clear context
4. Resume from next unmarked phase

**Source of truth:** `plan.md` + `tasks.md`

---

## Ready to Execute

**Approve this task breakdown to begin Phase 0.**
