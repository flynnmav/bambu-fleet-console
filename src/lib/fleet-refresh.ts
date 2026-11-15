import type { FleetResponse } from '../types';

interface RefreshHandlers {
  onResult: (fleet: FleetResponse) => void;
  onError: (reason: unknown) => void;
  onSettled: () => void;
}

export function createFleetRefresh(load: (signal: AbortSignal) => Promise<FleetResponse>) {
  let active: AbortController | null = null;

  return {
    async run(replace: boolean, handlers: RefreshHandlers) {
      if (active && !replace) return;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      try {
        const fleet = await load(controller.signal);
        if (active === controller) handlers.onResult(fleet);
      } catch (reason) {
        if (active === controller) handlers.onError(reason);
      } finally {
        if (active === controller) {
          active = null;
          handlers.onSettled();
        }
      }
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}
