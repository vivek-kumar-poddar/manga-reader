// Shared data contracts; importing this file performs no storage or browser work.
export interface Directory extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
}
export interface Page {
  dimensionsPending?: boolean;
  name: string;
  path: string;
  width: number;
  height: number;
  size?: number;
  modified?: number;
}
export interface Position {
  page: number;
  path?: string;
  fraction: number;
}
export interface Chapter {
  name: string;
  pages: Page[];
  read: boolean;
  position?: Position;
  bookmarks?: Position[];
}
export interface Manga {
  id: string;
  slug?: string;
  title: string;
  chapters: Chapter[];
  handle?: Directory;
  localPath?: string; // Electron only: absolute path to the manga folder on disk.
  cover?: Blob;
  lastChapter: number;
  addedAt: number;
  updatedAt: number;
  sort?: 'natural' | 'name' | 'reverse';
}
export type Summary = Omit<Manga, 'chapters' | 'cover'> & {
  chapterCount: number;
  chaptersRead: number;
  lastChapterName: string;
  hasProgress: boolean;
  indexedAt: number;
};
export interface Progress {
  mangaId: string;
  chapter: string;
  read: boolean;
  position?: Position;
  bookmarks?: Position[];
}
export interface Settings {
  shelfSort?: 'recent' | 'title' | 'added' | 'progress';
  theme: 'system' | 'light' | 'dark';
  mode: 'continuous' | 'single';
  layout: 'width' | 'height' | 'auto' | 'max';
  maxWidth: number;
  seconds: number; // Per visible screen in continuous mode; per page/spread in single mode.
  advance: boolean;
  reduced: boolean;
  lowQuality: boolean;
  customSeconds: boolean;
  autoHideBars: boolean;
  resumeDelay: number;
  direction: 'ltr' | 'rtl';
  spread: boolean;
  singleCover: boolean;
  endAction: 'next' | 'stop' | 'replay';
}
export const defaults: Settings = {
  theme: 'system',
  mode: 'continuous',
  layout: 'max',
  maxWidth: 920,
  seconds: 3,
  advance: true,
  reduced: false,
  lowQuality: false,
  customSeconds: false,
  autoHideBars: true,
  resumeDelay: 1.8,
  direction: 'ltr',
  spread: false,
  singleCover: true,
  endAction: 'next',
};
