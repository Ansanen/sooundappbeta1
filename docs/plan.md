# Soound — Phase-Coherent Distributed Audio System
## Architecture Plan v1.0

---

## 1. System Overview

**Goal:** Synchronize audio playback across heterogeneous devices (PC, mobile, tablet) within a **5-10ms tolerance window** to prevent comb filtering and achieve phase-coherent playback.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SOOUND SERVER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │  Signaling  │  │    Room     │  │      Audio Chunk Server     │ │
│  │  (WebSocket)│  │  Manager    │  │  (WebTransport / WS Binary) │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────────┬──────────────┘ │
│         │                │                         │                │
└─────────┼────────────────┼─────────────────────────┼────────────────┘
          │                │                         │
          ▼                ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │   Time Sync     │  │  Audio Receiver  │  │   Audio Renderer   │  │
│  │   Web Worker    │  │  (WebTransport/  │  │   (AudioWorklet +  │  │
│  │   (NTP-like)    │  │   WS Fallback)   │  │   WASM Resampler)  │  │
│  └────────┬────────┘  └────────┬─────────┘  └─────────┬──────────┘  │
│           │                    │                      │              │
│           └────────────────────┴──────────────────────┘              │
│                                │                                     │
│                    ┌───────────▼───────────┐                        │
│                    │   Web Audio Context   │                        │
│                    │   (AudioDestination)  │                        │
│                    └───────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Time Synchronization (Web Worker)

**Location:** `src/workers/time-sync.worker.ts`

**Responsibilities:**
- Calculate continuous clock offset between client and server
- Measure network RTT using NTP-like intersection algorithm
- Run independently from main thread (immune to background tab throttling)
- Use `performance.timeOrigin + performance.now()` exclusively

**Algorithm:**
```
For each ping round (8 samples):
  1. Client sends t0 = performance.timeOrigin + performance.now()
  2. Server responds with { t0, t1: serverTime, t2: serverTime }
  3. Client records t3 = performance.timeOrigin + performance.now()
  
  RTT = (t3 - t0) - (t2 - t1)  // Subtract server processing time
  Offset = ((t1 - t0) + (t2 - t3)) / 2
  
Sort by RTT, take median of best 4 samples.
Repeat every 5 seconds with exponential backoff on stable networks.
```

**Output:** `{ offset: number, rtt: number, confidence: number }`

### 2.2 Signaling Server

**Location:** `server.ts` (existing, enhanced)

**Protocol:**
```typescript
// Client → Server
{ type: 'join_room', roomId: string, userId: string }
{ type: 'time_sync_request', t0: number }
{ type: 'select_track', trackId: string }

// Server → Client
{ type: 'room_state', ... }
{ type: 'time_sync_response', t0: number, t1: number, t2: number }
{ type: 'play_command', T_start: number, position: number }  // Absolute global timestamp
{ type: 'pause_command', position: number }
{ type: 'track_ready', streamUrl: string, duration: number }
```

### 2.3 Media Transport Layer

**Primary:** WebTransport (HTTP/3 + QUIC)
- Avoids TCP head-of-line blocking
- Unordered datagrams for audio chunks
- Stream for metadata/control

**Fallback:** Binary WebSocket
- For browsers without WebTransport support (Safari, older browsers)
- Chunked binary frames with sequence numbers

**Chunk Format:**
```
┌──────────────┬──────────────┬──────────────┬──────────────────────┐
│ seq (4 bytes)│ ts (8 bytes) │ len (4 bytes)│ PCM data (variable)  │
└──────────────┴──────────────┴──────────────┴──────────────────────┘
```

### 2.4 Audio Rendering Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                      AudioWorkletProcessor                          │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────┐ │
│  │ Ring Buffer │───▶│ WASM Resampler  │───▶│ Output (128 frames) │ │
│  │ (decoded    │    │ (Speex/libsamplerate) │                     │ │
│  │  PCM chunks)│    │ Pitch-preserving │                          │ │
│  └─────────────┘    └─────────────────┘    └─────────────────────┘ │
│                              ▲                                      │
│                              │                                      │
│                    ┌─────────┴─────────┐                           │
│                    │  Drift Calculator │                           │
│                    │  (target vs actual)│                           │
│                    └───────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Components:**

1. **Ring Buffer** — Circular buffer holding ~2-5 seconds of decoded PCM
2. **WASM Resampler** — libsamplerate or Speex compiled to WASM
   - Dynamically adjusts ratio based on drift
   - Preserves pitch (no playbackRate manipulation)
3. **Drift Calculator** — Compares:
   - `idealPosition = T_start_local + elapsed`
   - `actualPosition = samples_played / sampleRate`
   - Adjusts resampling ratio to converge within 5-10ms

### 2.5 Output Latency Compensation

**Automatic:**
```javascript
const ctx = new AudioContext();
const { contextTime, performanceTime } = ctx.getOutputTimestamp();
const outputLatency = ctx.outputLatency;

// Global T_start → Local AudioContext time
const localStartTime = (T_start - offset - performanceTime) / 1000 
                       + contextTime 
                       - outputLatency;
```

**Manual Calibration:**
- UI slider: -100ms to +100ms
- Stored in localStorage per device
- Applied as additional offset to localStartTime

---

## 3. Technology Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| Server Runtime | Node.js 20+ | WebSocket + WebTransport support |
| Signaling | ws + Socket.IO | Proven reliability |
| WebTransport | @aspect/wtransport | HTTP/3 QUIC transport |
| Audio Decode | Web Audio API + OfflineAudioContext | Browser-native decoding |
| Sync Logic | Web Worker + SharedArrayBuffer | Thread isolation |
| Resampling | libsamplerate-wasm | High-quality pitch-preserving |
| Audio Render | AudioWorkletProcessor | Low-latency, real-time safe |
| UI | React + TypeScript | Existing codebase |

---

## 4. Data Flow

### 4.1 Track Start Sequence

```
1. Host selects track
2. Server downloads/converts audio
3. Server broadcasts: track_ready { streamUrl, duration }
4. All clients: Begin fetching audio chunks via WebTransport
5. Clients buffer ~2 seconds of decoded PCM
6. Host presses PLAY
7. Server calculates: T_start = serverTime + 3000ms (3s prep time)
8. Server broadcasts: play_command { T_start, position: 0 }
9. Each client:
   a. Converts T_start to local AudioContext time
   b. Schedules AudioWorklet to start outputting at that time
   c. WASM resampler continuously adjusts for drift
```

### 4.2 Continuous Sync

```
Every 128 samples (~2.9ms at 44.1kHz):
  1. AudioWorklet calculates ideal position based on T_start
  2. Compares with actual ring buffer read position
  3. Adjusts resampling ratio:
     - Drift > 0 (ahead): ratio < 1.0 (slow down)
     - Drift < 0 (behind): ratio > 1.0 (speed up)
     - Clamped to ±3% to avoid artifacts
  4. If |drift| > 100ms: Hard reset (re-seek)
```

---

## 5. Browser Compatibility

| Feature | Chrome 116+ | Firefox 115+ | Safari 17+ | Edge 116+ |
|---------|-------------|--------------|------------|-----------|
| WebTransport | ✅ | ✅ | ❌ | ✅ |
| AudioWorklet | ✅ | ✅ | ✅ | ✅ |
| WASM in Worklet | ✅ | ✅ | ✅ | ✅ |
| SharedArrayBuffer | ✅* | ✅* | ✅* | ✅* |

*Requires Cross-Origin-Isolated headers:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

---

## 6. File Structure

```
src/
├── workers/
│   ├── time-sync.worker.ts      # NTP-like sync in Web Worker
│   └── audio-decoder.worker.ts  # Decode chunks off main thread
├── worklets/
│   ├── sync-processor.ts        # AudioWorkletProcessor
│   └── wasm/
│       ├── resampler.wasm       # Compiled libsamplerate
│       └── resampler.js         # WASM loader
├── lib/
│   ├── transport/
│   │   ├── webtransport.ts      # WebTransport client
│   │   └── ws-fallback.ts       # Binary WebSocket fallback
│   ├── sync/
│   │   ├── clock.ts             # Global clock abstraction
│   │   └── drift-calculator.ts  # Drift detection & correction
│   └── audio/
│       ├── ring-buffer.ts       # Lock-free ring buffer
│       └── decoder.ts           # Audio decoding utilities
├── hooks/
│   └── useSyncedAudio.ts        # Main React hook
└── components/
    └── LatencyCalibration.tsx   # Manual offset slider
    
server/
├── signaling.ts                 # WebSocket room management
├── transport/
│   ├── webtransport-server.ts   # HTTP/3 server
│   └── audio-streamer.ts        # Chunk audio into transport
└── audio/
    └── transcoder.ts            # Convert YouTube → PCM chunks
```

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Sync Accuracy | ≤10ms between any two clients | Cross-device oscilloscope test |
| RTT Stability | <50ms variance | Time sync worker metrics |
| Playback Latency | <300ms from press to sound | User-perceived measurement |
| Drift Correction | No audible artifacts | A/B listening test |
| CPU Usage | <15% on mobile | Chrome DevTools profiling |

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Safari no WebTransport | 25% mobile users | Binary WS fallback ready |
| WASM in Worklet slow on old devices | Audio stutters | Detect, fallback to simple mode |
| Background tab throttling | Sync drift | Time sync in Worker, wake locks |
| High RTT networks (>200ms) | Sync impossible | Increase buffer, warn user |
| iOS Safari AudioContext restrictions | No sound | User gesture unlock flow |

---

## Approval Required

Please review this architecture plan. If approved, I will generate `tasks.md` with detailed implementation phases.

**Questions for clarification:**
1. Do we need to support Safari immediately, or can WebTransport-only be Phase 1?
2. What's the target number of simultaneous listeners per room?
3. Should the WASM resampler be Speex or libsamplerate (higher quality)?
