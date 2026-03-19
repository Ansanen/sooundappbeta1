/**
 * GlobalClock — High-level clock synchronization interface
 * 
 * Wraps the time-sync Web Worker and provides a clean API
 * for getting synchronized time across all clients.
 */

type SyncUpdateCallback = (state: SyncState) => void;

export interface SyncState {
  offset: number;      // Milliseconds to add to local time
  rtt: number;         // Round-trip time in ms
  confidence: number;  // 0-1 sync confidence
  connected: boolean;
  samples: number;
}

export class GlobalClock {
  private worker: Worker | null = null;
  private state: SyncState = {
    offset: 0,
    rtt: 100,
    confidence: 0,
    connected: false,
    samples: 0
  };
  private callbacks: Set<SyncUpdateCallback> = new Set();
  private pendingTimeRequests: Map<number, (result: any) => void> = new Map();
  private requestId = 0;
  
  /**
   * Initialize the clock synchronization
   * @param socketUrl WebSocket URL for time sync (e.g., wss://soound.app/socket.io/)
   */
  async start(socketUrl: string): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
    }
    
    // Create worker
    this.worker = new Worker(
      new URL('../../workers/time-sync.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Handle messages from worker
    this.worker.onmessage = (event) => {
      const { type } = event.data;
      
      switch (type) {
        case 'connected':
          this.state.connected = true;
          this.notifyCallbacks();
          break;
          
        case 'disconnected':
          this.state.connected = false;
          this.notifyCallbacks();
          break;
          
        case 'sync_update':
          this.state = {
            ...this.state,
            offset: event.data.offset,
            rtt: event.data.rtt,
            confidence: event.data.confidence,
            samples: event.data.samples
          };
          this.notifyCallbacks();
          break;
          
        case 'time_response':
          const resolver = this.pendingTimeRequests.get(event.data.id);
          if (resolver) {
            resolver(event.data);
            this.pendingTimeRequests.delete(event.data.id);
          }
          break;
          
        case 'error':
          console.error('[GlobalClock] Worker error:', event.data.error);
          break;
      }
    };
    
    // Start connection
    this.worker.postMessage({
      type: 'connect',
      payload: { url: socketUrl }
    });
  }
  
  /**
   * Stop the clock synchronization
   */
  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'disconnect' });
      this.worker.terminate();
      this.worker = null;
    }
    this.state.connected = false;
    this.notifyCallbacks();
  }
  
  /**
   * Get the current estimated server time
   */
  getServerTime(): number {
    return this.getLocalTime() + this.state.offset;
  }
  
  /**
   * Get the high-resolution local time
   */
  getLocalTime(): number {
    return performance.timeOrigin + performance.now();
  }
  
  /**
   * Get the current clock offset (local + offset = server)
   */
  getOffset(): number {
    return this.state.offset;
  }
  
  /**
   * Get the current round-trip time
   */
  getRTT(): number {
    return this.state.rtt;
  }
  
  /**
   * Get the sync confidence (0-1)
   */
  getConfidence(): number {
    return this.state.confidence;
  }
  
  /**
   * Check if clock is synchronized
   */
  isConnected(): boolean {
    return this.state.connected;
  }
  
  /**
   * Convert server time to local time
   */
  toLocalTime(serverTime: number): number {
    return serverTime - this.state.offset;
  }
  
  /**
   * Convert local time to server time
   */
  toServerTime(localTime: number): number {
    return localTime + this.state.offset;
  }
  
  /**
   * Get the current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }
  
  /**
   * Subscribe to sync state updates
   */
  subscribe(callback: SyncUpdateCallback): () => void {
    this.callbacks.add(callback);
    // Immediately call with current state
    callback(this.state);
    
    return () => {
      this.callbacks.delete(callback);
    };
  }
  
  /**
   * Force a sync round
   */
  forceSync(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'force_sync' });
    }
  }
  
  /**
   * Get precise time with callback (async via worker)
   */
  async getPreciseTime(): Promise<{
    serverTime: number;
    localTime: number;
    offset: number;
    rtt: number;
    confidence: number;
  }> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({
          serverTime: this.getServerTime(),
          localTime: this.getLocalTime(),
          offset: this.state.offset,
          rtt: this.state.rtt,
          confidence: this.state.confidence
        });
        return;
      }
      
      const id = ++this.requestId;
      this.pendingTimeRequests.set(id, resolve);
      
      this.worker.postMessage({
        type: 'get_time',
        payload: { id }
      });
      
      // Timeout fallback
      setTimeout(() => {
        if (this.pendingTimeRequests.has(id)) {
          this.pendingTimeRequests.delete(id);
          resolve({
            serverTime: this.getServerTime(),
            localTime: this.getLocalTime(),
            offset: this.state.offset,
            rtt: this.state.rtt,
            confidence: this.state.confidence
          });
        }
      }, 1000);
    });
  }
  
  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      try {
        callback(this.state);
      } catch (e) {
        console.error('[GlobalClock] Callback error:', e);
      }
    }
  }
}

// Singleton instance
export const globalClock = new GlobalClock();
