/**
 * WebTransport Client
 * 
 * HTTP/3 + QUIC transport for low-latency audio streaming.
 * Uses datagrams for audio chunks (unordered, unreliable for minimal latency)
 * and streams for control messages (reliable).
 * 
 * Note: WebTransport is not supported in Safari as of 2024.
 * This is the preferred transport when available.
 */

import { AudioChunk, decodeChunk } from './chunk-protocol';

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface QuicTransportOptions {
  url: string;
  onChunk?: (chunk: AudioChunk) => void;
  onStateChange?: (state: TransportState) => void;
  onError?: (error: Error) => void;
}

export class QuicTransport {
  private transport: WebTransport | null = null;
  private url: string;
  private state: TransportState = 'disconnected';
  private shouldReconnect = true;
  private datagramReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  
  // Callbacks
  private onChunk?: (chunk: AudioChunk) => void;
  private onStateChange?: (state: TransportState) => void;
  private onError?: (error: Error) => void;
  
  // Stats
  private chunksReceived = 0;
  private bytesReceived = 0;
  private startTime = 0;
  
  constructor(options: QuicTransportOptions) {
    this.url = options.url;
    this.onChunk = options.onChunk;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }
  
  /**
   * Check if WebTransport is supported
   */
  static isSupported(): boolean {
    return typeof WebTransport !== 'undefined';
  }
  
  /**
   * Connect to the WebTransport server
   */
  async connect(): Promise<void> {
    if (!QuicTransport.isSupported()) {
      throw new Error('WebTransport is not supported in this browser');
    }
    
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }
    
    this.shouldReconnect = true;
    this.setState('connecting');
    
    try {
      // Convert to https:// URL (WebTransport requires HTTPS)
      const wtUrl = this.url.replace(/^http:/, 'https:').replace(/^ws:/, 'https:').replace(/^wss:/, 'https:');
      
      this.transport = new WebTransport(wtUrl);
      await this.transport.ready;
      
      this.setState('connected');
      this.startTime = performance.now();
      this.chunksReceived = 0;
      this.bytesReceived = 0;
      
      // Start reading datagrams
      this.readDatagrams();
      
      // Handle connection close
      this.transport.closed.then(() => {
        this.setState('disconnected');
        this.scheduleReconnect();
      }).catch((error) => {
        this.onError?.(error);
        this.setState('error');
        this.scheduleReconnect();
      });
      
    } catch (error) {
      this.setState('error');
      this.onError?.(error as Error);
      throw error;
    }
  }
  
  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.datagramReader) {
      this.datagramReader.cancel();
      this.datagramReader = null;
    }
    
    if (this.transport) {
      this.transport.close();
      this.transport = null;
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
      state: this.state,
      transportType: 'webtransport' as const,
    };
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }
  
  private async readDatagrams(): Promise<void> {
    if (!this.transport?.datagrams?.readable) {
      return;
    }
    
    try {
      this.datagramReader = this.transport.datagrams.readable.getReader();
      
      while (true) {
        const { value, done } = await this.datagramReader.read();
        
        if (done) {
          break;
        }
        
        if (value) {
          this.handleDatagram(value);
        }
      }
    } catch (error) {
      if (this.state === 'connected') {
        console.error('[QuicTransport] Datagram read error:', error);
      }
    } finally {
      this.datagramReader = null;
    }
  }
  
  private handleDatagram(data: Uint8Array): void {
    try {
      const chunk = decodeChunk(data.buffer as ArrayBuffer);
      
      // Update stats
      this.chunksReceived++;
      this.bytesReceived += data.byteLength;
      
      // Deliver chunk
      this.onChunk?.(chunk);
      
    } catch (error) {
      console.error('[QuicTransport] Failed to decode datagram:', error);
    }
  }
  
  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }
  
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch(() => {
          // Will retry
        });
      }
    }, 3000);
  }
}
