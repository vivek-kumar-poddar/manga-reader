import { createContext, useContext } from 'react';
import type { Manga, Summary, Settings } from '../data';

export interface Context {
  settings: Settings;
  setSettings: (s: Settings) => void;
  openSettings: () => void;
  notify: (s: string) => void;
  pick: (m?: Summary | Manga) => Promise<void>;
  relink: (m: Summary | Manga) => Promise<boolean>;
  library: Summary[];
  refresh: () => Promise<void>;
}

export const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
