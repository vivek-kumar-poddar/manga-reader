import type { Manga } from '../model';
import { desktopAPI } from './api';
import {
  stopBackground as webStopBackground,
  stopAllBackground as webStopAllBackground,
  scheduleBackground as webScheduleBackground,
  resumeBackground as webResumeBackground,
} from '../web/importScan';

export function stopBackground(id: string): void {
  if (desktopAPI.isDesktop && desktopAPI.stopBackground) {
    void desktopAPI.stopBackground(id);
    return;
  }
  webStopBackground(id);
}

export function stopAllBackground(): void {
  if (desktopAPI.isDesktop && desktopAPI.stopAllBackground) {
    void desktopAPI.stopAllBackground();
    return;
  }
  webStopAllBackground();
}

export function scheduleBackground(manga: Manga, priorityChapter?: number): void {
  if (desktopAPI.isDesktop && desktopAPI.scheduleBackground) {
    if (!manga.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))) return;
    void desktopAPI.scheduleBackground(manga.id, priorityChapter);
    return;
  }
  webScheduleBackground(manga, priorityChapter);
}

export async function resumeBackground(): Promise<void> {
  if (desktopAPI.isDesktop && desktopAPI.resumeBackground) {
    await desktopAPI.resumeBackground();
    return;
  }
  await webResumeBackground();
}
