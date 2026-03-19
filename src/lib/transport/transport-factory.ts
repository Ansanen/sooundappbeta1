/**
 * Transport Factory
 * 
 * Auto-selects the best available transport:
 * 1. WebTransport (QUIC) - preferred, lowest latency
 * 2. Binary WebSocket - fallback for Safari and older browsers
 */

import { QuicTransport, QuicTransportOptions } from './webtransport';
import { BinaryWSTransport, BinaryWSTransportOptions } from './ws-binary';
import { AudioChunk } from './chunk-protocol';

export type TransportType = 'webtransport' | 'websocket';
export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TransportOptions {
  url: string;
  onChunk?: (chunk: AudioChunk) => void;
  onStateChange?: (state: TransportState) => void;
  onError?: (error: Error) => void;
  forceWebSocket?: boolean;  // Force WebSocket even if WebTransport available
}

export interface Transport {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getStats(): {
    chunksReceived: number;
    bytesReceived: number;
    bytesPerSecond: number;
    state: TransportState;
  };
}

/**
 * Create the best available transport for the current browser
 */
export function createTransport(options: TransportOptions): Transport {
  const transportType = selectTransportType(options.forceWebSocket);
  
  console.log(`[Transport] Using ${transportType}`);
  
  if (transportType === 'webtransport') {
    return new QuicTransport({
      url: options.url,
      onChunk: options.onChunk,
      onStateChange: options.onStateChange,
      onError: options.onError,
    });
  }
  
  return new BinaryWSTransport({
    url: options.url,
    onChunk: options.onChunk,
    onStateChange: options.onStateChange,
    onError: options.onError,
  });
}

/**
 * Detect the best transport type for the current browser
 */
export function selectTransportType(forceWebSocket?: boolean): TransportType {
  if (forceWebSocket) {
    return 'websocket';
  }
  
  // Check WebTransport support
  if (QuicTransport.isSupported()) {
    return 'webtransport';
  }
  
  // Fallback to WebSocket
  return 'websocket';
}

/**
 * Get browser transport capabilities
 */
export function getTransportCapabilities(): {
  webTransport: boolean;
  webSocket: boolean;
  sharedArrayBuffer: boolean;
  audioWorklet: boolean;
} {
  return {
    webTransport: typeof WebTransport !== 'undefined',
    webSocket: typeof WebSocket !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
  };
}
