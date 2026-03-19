/**
 * Time Sync Web Worker
 * 
 * Implements NTP-like clock synchronization algorithm.
 * Runs in Web Worker to be immune to background tab throttling.
 * Uses performance.timeOrigin + performance.now() for high-resolution timing.
 */

interface SyncPing {
  type: 'sync_pong';
  t0: number;  // Client send time
  t1: number;  // Server receive time
  t2: number;  // Server send time
}

interface SyncSample {
  offset: number;
  rtt: number;
  timestamp: number;
}

interface SyncResult {
  offset: number;      // Milliseconds to add to local time to get server time
  rtt: number;         // Round-trip time in ms
  confidence: number;  // 0-1, based on RTT stability
  samples: number;     // Number of valid samples
}

// Configuration
const SAMPLES_PER_ROUND = 8;
const BEST_SAMPLES = 4;
const MIN_PING_INTERVAL = 100;   // ms between pings
const SYNC_INTERVAL = 5000;      // ms between sync rounds
const MAX_RTT = 2000;            // Discard samples with RTT > this
const STABLE_RTT_VARIANCE = 20;  // Consider stable if variance < this

// State
let ws: WebSocket | null = null;
let isConnected = false;
let samples: SyncSample[] = [];
let pendingPings = new Map<number, number>();  // t0 -> timestamp
let currentOffset = 0;
let currentRTT = 100;
let confidence = 0;
let syncInterval: ReturnType<typeof setInterval> | null = null;

function getHighResTime(): number {
  return performance.timeOrigin + performance.now();
}

function sendPing() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const t0 = getHighResTime();
  pendingPings.set(t0, Date.now());
  
  ws.send(JSON.stringify({
    type: 'sync_ping',
    t0: t0
  }));
}

function processPong(data: SyncPing) {
  const t3 = getHighResTime();
  const { t0, t1, t2 } = data;
  
  // Clean up pending
  pendingPings.delete(t0);
  
  // Calculate RTT (subtract server processing time)
  const rtt = (t3 - t0) - (t2 - t1);
  
  // Discard high RTT samples
  if (rtt > MAX_RTT || rtt < 0) {
    return;
  }
  
  // Calculate offset using intersection algorithm
  // offset = ((t1 - t0) + (t2 - t3)) / 2
  const offset = ((t1 - t0) + (t2 - t3)) / 2;
  
  samples.push({
    offset,
    rtt,
    timestamp: t3
  });
}

function calculateSync(): SyncResult {
  if (samples.length < 2) {
    return { offset: currentOffset, rtt: currentRTT, confidence: 0, samples: samples.length };
  }
  
  // Sort by RTT, take best samples
  const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);
  const best = sorted.slice(0, BEST_SAMPLES);
  
  // Calculate median offset of best samples
  const offsets = best.map(s => s.offset).sort((a, b) => a - b);
  const medianOffset = offsets[Math.floor(offsets.length / 2)];
  
  // Calculate mean RTT
  const meanRTT = best.reduce((sum, s) => sum + s.rtt, 0) / best.length;
  
  // Calculate confidence based on RTT variance
  const rttVariance = best.reduce((sum, s) => sum + Math.pow(s.rtt - meanRTT, 2), 0) / best.length;
  const rttStdDev = Math.sqrt(rttVariance);
  const conf = Math.max(0, Math.min(1, 1 - (rttStdDev / STABLE_RTT_VARIANCE)));
  
  return {
    offset: medianOffset,
    rtt: meanRTT,
    confidence: conf,
    samples: best.length
  };
}

async function runSyncRound() {
  samples = [];
  pendingPings.clear();
  
  // Send SAMPLES_PER_ROUND pings with small delays
  for (let i = 0; i < SAMPLES_PER_ROUND; i++) {
    sendPing();
    await new Promise(r => setTimeout(r, MIN_PING_INTERVAL));
  }
  
  // Wait for responses
  await new Promise(r => setTimeout(r, 500));
  
  // Calculate result
  const result = calculateSync();
  
  // Update state with exponential smoothing
  if (result.confidence > 0.3) {
    const alpha = result.confidence * 0.3;  // Smoothing factor
    currentOffset = currentOffset * (1 - alpha) + result.offset * alpha;
    currentRTT = currentRTT * (1 - alpha) + result.rtt * alpha;
    confidence = result.confidence;
  }
  
  // Report to main thread
  self.postMessage({
    type: 'sync_update',
    offset: currentOffset,
    rtt: currentRTT,
    confidence: confidence,
    samples: result.samples
  });
}

function connect(url: string) {
  if (ws) {
    ws.close();
  }
  
  // Convert HTTP URL to WebSocket URL
  const wsUrl = url.replace(/^http/, 'ws');
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    isConnected = true;
    self.postMessage({ type: 'connected' });
    
    // Start sync rounds
    runSyncRound();
    syncInterval = setInterval(runSyncRound, SYNC_INTERVAL);
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'sync_pong') {
        processPong(data);
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  };
  
  ws.onclose = () => {
    isConnected = false;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    self.postMessage({ type: 'disconnected' });
    
    // Reconnect after delay
    setTimeout(() => {
      if (!isConnected) {
        connect(url);
      }
    }, 3000);
  };
  
  ws.onerror = (error) => {
    self.postMessage({ type: 'error', error: 'WebSocket error' });
  };
}

// Handle messages from main thread
self.onmessage = (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'connect':
      connect(payload.url);
      break;
      
    case 'disconnect':
      if (ws) {
        ws.close();
        ws = null;
      }
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
      break;
      
    case 'force_sync':
      runSyncRound();
      break;
      
    case 'get_time':
      // Return current server time estimate
      const serverTime = getHighResTime() + currentOffset;
      self.postMessage({
        type: 'time_response',
        id: payload.id,
        serverTime,
        localTime: getHighResTime(),
        offset: currentOffset,
        rtt: currentRTT,
        confidence
      });
      break;
  }
};

// Export for type checking
export {};
