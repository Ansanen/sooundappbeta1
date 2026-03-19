/**
 * Binary WebSocket Transport
 * 
 * Fallback transport for browsers without WebTransport (Safari, older browsers).
 * Uses binary WebSocket frames for efficient audio chunk delivery.
 */

import { AudioChunk, decodeChunk } from './chunk-protocol';

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BinaryWSTransportOptions {
  url: string;
  onChunk?: (chunk: AudioChunk) => void;
  onStateChange?: (state: TransportState) => void;
  onError?: (error: Error) => void;
  reconnectDelay?: number;
}

export class BinaryWSTransport {
  private ws: WebSocket | null = null;
  private url: string;
  private state: TransportState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private lastSeq = -1;
  private gapCount = 0;
  
  // Callbacks
  private onChunk?: (chunk: AudioChunk) => void;
  private onStateChange?: (state: TransportState) => void;
  private onError?: (error: Error) => void;
  
  // Stats
  private chunksReceived = 0;
  private bytesReceived = 0;
  private startTime = 0;
  
  constructor(options: BinaryWSTransportOptions) {
    this.url = options.url;
    this.onChunk = options.onChunk;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }
  
  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }
    
    this.shouldReconnect = true;
    this.setState('connecting');
    
    return new Promise((resolve, reject) => {
      try {
        // Convert HTTP(S) to WS(S)
        const wsUrl = this.url.replace(/^http/, 'ws');
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
        
        this.ws.onopen = () => {
          this.setState('connected');
          this.startTime = performance.now();
          this.chunksReceived = 0;
          this.bytesReceived = 0;
          this.lastSeq = -1;
          this.gapCount = 0;
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };
        
        this.ws.onerror = (event) => {
          const error = new Error('WebSocket error');
          this.onError?.(error);
          reject(error);
        };
        
        this.ws.onclose = () => {
          this.setState('disconnected');
          this.scheduleReconnect();
        };
        
      } catch (error) {
        this.setState('error');
        reject(error);
      }
    });
  }
  
  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.setState('disconnected');
  }
  
  /**
   * Get transport statistics
   */
  getStats() {
    const elapsed = (performance.now() - this.startTime) / 1000;
    return {
      chunksReceived: this.chunksReceived,
      bytesReceived: this.bytesReceived,
      bytesPerSecond: elapsed > 0 ? this.bytesReceived / elapsed : 0,
      gapCount: this.gapCount,
      state: this.state,
    };
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }
  
  private handleMessage(event: MessageEvent): void {
    // Handle binary audio chunks
    if (event.data instanceof ArrayBuffer) {
      try {
        const chunk = decodeChunk(event.data);
        
        // Track sequence gaps
        if (this.lastSeq >= 0 && chunk.seq !== this.lastSeq + 1) {
          this.gapCount++;
          console.warn(`[WSTransport] Sequence gap: expected ${this.lastSeq + 1}, got ${chunk.seq}`);
        }
        this.lastSeq = chunk.seq;
        
        // Update stats
        this.chunksReceived++;
        this.bytesReceived += event.data.byteLength;
        
        // Deliver chunk
        this.onChunk?.(chunk);
        
      } catch (error) {
        console.error('[WSTransport] Failed to decode chunk:', error);
      }
    }
    // Handle JSON control messages
    else if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        // Handle control messages if needed
        console.log('[WSTransport] Control message:', msg);
      } catch {
        // Ignore non-JSON strings
      }
    }
  }
  
  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }
  
  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect().catch(() => {
          // Will retry via onclose
        });
      }
    }, 3000);
  }
}
