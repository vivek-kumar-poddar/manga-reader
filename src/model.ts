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
  mangaBookmark?: boolean;
  timestamp?: number;
}
export interface Chapter {
  id?: string;
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
  localPath?: string;
  cover?: Blob;
  lastChapter: number;
  addedAt: number;
  updatedAt: number;
  revision?: number;
  sort?: 'natural' | 'name' | 'reverse';
}
export type Summary = Omit<Manga, 'chapters' | 'cover'> & {
  chapterCount: number;
  chaptersRead: number;
  lastChapterName: string;
  hasProgress: boolean;
  indexedAt: number;
  revision?: number;
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
  seconds: number;
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
  fontSizeTitle: number;
  fontSizeUi: number;
  fontSizeButton: number;
  confirmDelete?: boolean;
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
  fontSizeTitle: 15,
  fontSizeUi: 15,
  fontSizeButton: 15,
  confirmDelete: false,
};