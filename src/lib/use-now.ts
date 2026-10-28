"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared one-second clock for live timers. The interval only runs while a
 * component is subscribed, and components subscribe only while something is
 * running, so idle pages don't tick.
 */
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const noop = () => () => {};
const getNow = () => now;
const getServerNow = () => 0;

/** Current time, ticking every second while `active`; null when inactive. */
export function useNow(active: boolean): number | null {
  const value = useSyncExternalStore(active ? subscribe : noop, getNow, getServerNow);
  return active && value ? value : null;
}
