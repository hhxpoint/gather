import type { GatherApi } from '../../preload';

declare global {
  interface Window {
    gather?: GatherApi;
  }
}

export {};
