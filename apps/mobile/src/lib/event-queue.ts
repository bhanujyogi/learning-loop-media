import NetInfo from '@react-native-community/netinfo';
import Storage from 'expo-sqlite/kv-store';
import { api } from './api';
import {
  ack,
  emptyQueue,
  enqueue,
  fail,
  nextBatch,
  type QueuedEvent,
  type QueueState,
} from './event-queue-core';

const KEY = 'll.eventQueue.v1';
let state: QueueState | null = null;
let flushing = false;

function load(): QueueState {
  if (state) return state;
  try {
    const raw = Storage.getItemSync(KEY);
    state = raw ? (JSON.parse(raw) as QueueState) : emptyQueue();
  } catch {
    state = emptyQueue();
  }
  return state;
}
const persist = () => {
  try {
    Storage.setItemSync(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: keep in memory */
  }
};

/** Fire-and-forget. Never throws and never blocks the UI. */
export function track(name: string, payload?: Record<string, unknown>) {
  state = enqueue(load(), { name, payload, at: Date.now() } satisfies QueuedEvent);
  persist();
  void flush();
}

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
    for (;;) {
      const batch = nextBatch(load(), Date.now());
      if (!batch.length) return;
      try {
        await api.events(batch);
        state = ack(load(), batch.length);
        persist();
      } catch {
        state = fail(load(), Date.now());
        persist();
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

NetInfo.addEventListener((s) => {
  if (s.isConnected) void flush();
});
