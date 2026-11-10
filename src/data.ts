// Unified facade module re-exporting model, validation, storage, images, and importScan.
export { defaults } from './model';
export type {
  Directory,
  Page,
  Position,
  Chapter,
  Manga,
  Summary,
  Progress,
  Settings,
} from './model';

export {
  matchingPosition,
  validateBackup,
  ValidationError,
  parsePosition,
  parseSettings,
  parseManga,
  parseSummary,
  validateRelativePath,
} from './validation';

export {
  db,
  summary,
  listLibrary,
  getManga,
  getCover,
  allManga,
  saveManga,
  saveProgress,
  getBookmarkedMangaIds,
  getMangaBookmarkedIds,
  addBookmark,
  removeBookmark,
  syncChannel,
  broadcastSync,
  deleteManga,
  clearLibrary,
  migrateV1ToV2,
  restoreBackup,
  resetProgress,
  getStoredSettings,
  saveStoredSettings,
  errorMessage,
  fileFor,
  access,
  sessionFiles,
  type SaveProgressResult,
  type MangaDB,
  type SourceFile,
} from './storage';

export { dimensions, thumbnail, imageFile, downscaleImage } from './images';
export { enqueueImage, clearImageQueue, ImageQueue, defaultImageQueue } from './imageQueue';

export {
  DesktopHandle,
  ElectronHandle,
  naturalOrder,
  ignored,
  fromDesktopFolder,
  fromElectronFolder,
  fromFiles,
  fromHandle,
  droppedSources,
  splitSource,
  chapterGroups,
  indexSource,
  prepareChapter,
  stopBackground,
  scheduleBackground,
  resumeBackground,
  discardScan,
  warmSources,
  type Issue,
  type ScanState,
  type ScanOptions,
  type Source,
} from './importScan';
