export interface PageStore {
  getPage: () => number;
  setPage: (page: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPageStore(initialPage = 0): PageStore {
  let current = initialPage;
  const listeners = new Set<() => void>();
  return {
    getPage: () => current,
    setPage: (page: number) => {
      if (current === page) return;
      current = page;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
