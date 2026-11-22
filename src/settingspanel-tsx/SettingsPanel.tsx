import { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useApp } from '../App';
import { limits, assertAtMost, withinTime } from '../limits';
import { desktopAPI, type StorageStats } from '../tauriBridge';
import {
  exportBackup,
  restoreBackup,
  resetProgress,
  clearLibrary,
  validateBackup,
  type Settings,
} from '../data';
import { tabs, type TabName } from './types';
import ReadingTab from './ReadingTab';
import AppearanceTab from './AppearanceTab';
import StorageTab from './StorageTab';
import AboutTab from './AboutTab';

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings: s, setSettings, notify, refresh, library } = useApp();
  const [tab, setTab] = useState<TabName>('Reading');
  const [usage, setUsage] = useState<StorageEstimate | null>(null);
  const [nativeStats, setNativeStats] = useState<StorageStats | null>(null);
  const [storageError, setStorageError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'progress' | 'all' | null>(null);
  const [clearing, setClearing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function updateStorage() {
    setStorageError('');
    if (desktopAPI.isDesktop && desktopAPI.getStorageStats) {
      try {
        const stats = await desktopAPI.getStorageStats();
        setNativeStats(stats);
        return;
      } catch {
        /* Fallback to navigator.storage */
      }
    }
    try {
      const estimate = await navigator.storage?.estimate?.();
      setUsage(estimate || null);
    } catch {
      setStorageError('Could not retrieve storage details.');
    }
  }

  useEffect(() => {
    if (open) {
      setConfirmAction(null);
      void updateStorage();
    }
  }, [open, library]);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings({ ...s, [key]: value });

  async function exportData() {
    const jsonStr = await exportBackup();
    if (desktopAPI.isDesktop && desktopAPI.saveFileDialog) {
      const saved = await desktopAPI.saveFileDialog('manga-reader-backup.json', jsonStr);
      if (saved) {
        notify('Backup saved successfully.');
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga-reader-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(file?: File) {
    if (!file) return;
    try {
      assertAtMost(file.size, limits.backupBytes, 'Backup size (bytes)');
      const text = await withinTime(file.text(), limits.ioTimeoutMs, 'Reading backup');
      const parsed = desktopAPI.isDesktop ? text : validateBackup(JSON.parse(text));
      const appliedSettings = await restoreBackup(parsed);
      setSettings(appliedSettings);
      await refresh();
      await updateStorage();
      notify('Backup imported. Re-link folders when requested.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not import backup.');
    }
  }

  async function clear() {
    if (!confirmAction) return;
    setClearing(true);
    try {
      if (confirmAction === 'progress') {
        await resetProgress();
      } else {
        await clearLibrary();
      }
      await refresh();
      await updateStorage();
      notify(confirmAction === 'progress' ? 'Reading progress cleared.' : 'Manga data cleared.');
      setConfirmAction(null);
    } catch {
      notify('Could not clear data. Please try again.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-panel tabbed-modal">
          <div className="modal-heading">
            <div className="dialog-heading">
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Close asChild>
                <button className="btn icon close-btn" aria-label="Close settings">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Make yourself comfortable. Changes save automatically.
            </Dialog.Description>
          </div>
          <div className="settings-tabs" role="tablist" aria-label="Settings categories">
            {tabs.map((name, i) => (
              <button
                key={name}
                type="button"
                role="tab"
                className="btn"
                id={'settings-tab-' + name}
                aria-controls={'settings-panel-' + name}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(e) => {
                  let next = i;
                  if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
                  else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = tabs.length - 1;
                  else return;
                  e.preventDefault();
                  setTab(tabs[next]);
                  document.getElementById('settings-tab-' + tabs[next])?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            className="settings-tab-body"
            role="tabpanel"
            id={'settings-panel-' + tab}
            aria-labelledby={'settings-tab-' + tab}
            tabIndex={0}
          >
            {tab === 'Reading' && (
              <ReadingTab settings={s} setSettings={setSettings} change={change} />
            )}
            {tab === 'Appearance' && (
              <AppearanceTab
                settings={s}
                setSettings={setSettings}
                change={change}
                notify={notify}
              />
            )}
            {tab === 'Storage' && (
              <StorageTab
                nativeStats={nativeStats}
                usage={usage}
                library={library}
                storageError={storageError}
                updateStorage={updateStorage}
                exportData={exportData}
                importData={importData}
                clear={clear}
                confirmAction={confirmAction}
                setConfirmAction={setConfirmAction}
                clearing={clearing}
                notify={notify}
                inputRef={input}
              />
            )}
            {tab === 'About' && <AboutTab />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
