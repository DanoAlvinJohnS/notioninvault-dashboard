// One lock around the plugin's data.json, shared by the dashboard (layout, theme, Canvas) and the vault agents (`agent` key).
// Dashboard saves never overwrite `agent` with an old copy, and agent saves re-read the file so they never drop the layout.
export function sharedData(load: () => Promise<any>, save: (d: any) => Promise<void>) {
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = chain.then(fn);
    chain = r.catch(() => {});
    return r;
  };
  return {
    /** For VaultService: whole-file load/save; `agent` always comes from disk. */
    store: {
      load: () => run(async () => (await load()) ?? {}),
      save: (d: any) => run(async () => {
        const cur = (await load()) ?? {}, next = { ...d };
        if (cur.agent === undefined) delete next.agent; else next.agent = cur.agent;
        await save(next);
      }),
    },
    /** The whole file, read inside the lock (for decisions made once at startup). */
    readAll(): Promise<any> { return run(async () => (await load()) ?? {}); },
    /** Sets one top-level key (e.g. `agentsEnabled`) without touching the rest. */
    setTop(key: string, value: unknown): Promise<void> {
      return run(async () => { const d = (await load()) ?? {}; d[key] = value; await save(d); });
    },
    /** For the agents: read `agent` without writing anything back (still ordered after pending writes). */
    readAgent<T>(fn: (agent: any) => T): Promise<T> {
      return run(async () => fn((await load())?.agent ?? {}));
    },
    /** For the agents: read, change and write only `agent`, all inside the lock. */
    agent<T>(fn: (agent: any) => T | Promise<T>): Promise<T> {
      return run(async () => {
        const d = (await load()) ?? {};
        d.agent ??= {};
        const out = await fn(d.agent);
        await save(d);
        return out;
      });
    },
  };
}
