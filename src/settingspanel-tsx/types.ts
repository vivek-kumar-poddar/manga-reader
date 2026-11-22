import type { Settings } from '../data';

export const tabs = ['Reading', 'Appearance', 'Storage', 'About'] as const;
export type TabName = (typeof tabs)[number];

export const formatBytes = (n: number) =>
  n < 1048576
    ? (n / 1024).toFixed(0) + ' KB'
    : n < 1073741824
      ? (n / 1048576).toFixed(1) + ' MB'
      : (n / 1073741824).toFixed(1) + ' GB';

export interface SettingsTabProps {
  settings: Settings;
  setSettings: (s: Settings) => void;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}
