// A ChatController whose engine is created on the first message. makeEngine is async (it loads child_process once), so a proxy queues sends until it is ready.
import { ChatController } from './engine/chat.ts';
import type { Agents } from './wire.ts';

export function lazyChat(api: Agents): ChatController {
  return new ChatController(ag => {
    const proxy: any = { name: ag.engine, onEvent: () => {}, sent: [] as string[], real: null as any,
      send(t: string) { if (proxy.real) proxy.real.send(t); else proxy.sent.push(t); },
      stop() { proxy.stopped = true; proxy.real?.stop(); } };
    api.makeEngine(ag).then(real => {
      if (proxy.stopped) { real.stop(); return; }
      real.onEvent = e => proxy.onEvent(e);
      proxy.real = real;
      for (const t of proxy.sent.splice(0)) real.send(t);
    }).catch(err => proxy.onEvent({ type: 'error', message: String(err?.message ?? err) }));
    return proxy;
  });
}
