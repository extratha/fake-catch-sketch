
import { SocketEvent } from '../types';

/**
 * Since we don't have a real Socket.io server in this environment,
 * we'll use BroadcastChannel to allow multiple tabs on the same machine to communicate.
 * This simulates the real-time experience requested.
 */
class MockSocket {
  private channel: BroadcastChannel;
  private listeners: Map<string, Array<(payload: any) => void>> = new Map();
  public id: string;

  constructor(userId: string) {
    this.id = userId;
    this.channel = new BroadcastChannel('cat-sketch-room');
    this.channel.onmessage = (event: MessageEvent<SocketEvent>) => {
      const { type, payload } = event.data;
      const handlers = this.listeners.get(type);
      if (handlers) {
        handlers.forEach(handler => handler(payload));
      }
    };
  }

  public on(event: string, callback: (payload: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  public emit(event: string, payload: any) {
    // Send to other tabs
    this.channel.postMessage({
      type: event,
      payload,
      senderId: this.id
    });
    
    // Also trigger locally if we're simulating a single player state or if we need loopback
    // In a real socket, usually the server sends back to everyone including sender for some events
  }

  public disconnect() {
    this.channel.close();
  }
}

export default MockSocket;
