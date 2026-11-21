// Pure registry: at most one Spark at a time, however often the setting or command toggles it.
export interface SparkHandle { destroy(): void; /** Says a random comment now; false when there is none to say. */ say?(): boolean }

export function sparkHost() {
  let cur: SparkHandle | null = null;
  return {
    mount(make: () => SparkHandle) { if (!cur) cur = make(); },
    unmount() { const c = cur; cur = null; c?.destroy(); },
    mounted() { return cur !== null; },
    current() { return cur; },
  };
}
