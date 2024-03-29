import { EventEmitter } from 'events';

export interface FayeClient extends EventEmitter {
  publish(subject: string, msg?: string | Buffer): void;
  // eslint-disable-next-line @typescript-eslint/ban-types
  subscribe(subject: string, callback: Function): Promise<any>;
  unsubscribe(subject: string): void;
  connect(): void;
  disconnect(): void;
}
