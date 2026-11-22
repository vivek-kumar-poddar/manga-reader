import type { DesktopAPI } from './types';
import { getPageImageUrl, getCoverImageUrl } from './urls';
import * as tauriFs from './tauriFs';
import * as tauriImages from './tauriImages';
import * as tauriDb from './tauriDb';
import * as tauriIndexing from './tauriIndexing';
import * as tauriApp from './tauriApp';

export class TauriDesktopBridge implements DesktopAPI {
  readonly isDesktop = true;
  readonly isTauri = true;

  // File system & directories
  selectFolder = tauriFs.selectFolder;
  listFolder = tauriFs.listFolder;
  discoverLibrary = tauriFs.discoverLibrary;
  naturalSortPaths = tauriFs.naturalSortPaths;
  resolvePath = tauriFs.resolvePath;
  checkAccess = tauriFs.checkAccess;
  revokeRoot = tauriFs.revokeRoot;
  getAuthorizedRoots = tauriFs.getAuthorizedRoots;
  cancelScan = tauriFs.cancelScan;
  readFile = tauriFs.readFile;
  isSamePath = tauriFs.isSamePath;
  convertFileSrc = tauriFs.convertFileSrc;

  // Images & dimensions
  getImageDimensions = tauriImages.getImageDimensions;
  getHeaderDimensions = tauriImages.getHeaderDimensions;
  decodeImageDimensions = tauriImages.decodeImageDimensions;
  generateThumbnailFromBytes = tauriImages.generateThumbnailFromBytes;
  downscaleImageBytes = tauriImages.downscaleImageBytes;
  clearDimensionCache = tauriImages.clearDimensionCache;
  saveThumbnail = tauriImages.saveThumbnail;
  getThumbnailUrl = tauriImages.getThumbnailUrl;
  generateThumbnail = tauriImages.generateThumbnail;
  generateImageVariant = tauriImages.generateImageVariant;
  getThumbnail = tauriImages.getThumbnail;
  deleteThumbnail = tauriImages.deleteThumbnail;
  clearThumbnails = tauriImages.clearThumbnails;

  // URLs
  getPageImageUrl = getPageImageUrl;
  getCoverImageUrl = getCoverImageUrl;

  // Database (SQLite) & backup
  isLibraryMigrated = tauriDb.isLibraryMigrated;
  importLegacyLibrary = tauriDb.importLegacyLibrary;
  sqliteListLibrary = tauriDb.sqliteListLibrary;
  sqliteGetManga = tauriDb.sqliteGetManga;
  sqliteSaveManga = tauriDb.sqliteSaveManga;
  sqliteSaveProgress = tauriDb.sqliteSaveProgress;
  sqliteAddBookmark = tauriDb.sqliteAddBookmark;
  sqliteRemoveBookmark = tauriDb.sqliteRemoveBookmark;
  sqliteGetBookmarkedMangaIds = tauriDb.sqliteGetBookmarkedMangaIds;
  getBookmarkCards = tauriDb.getBookmarkCards;
  sqliteDeleteManga = tauriDb.sqliteDeleteManga;
  sqliteClearLibrary = tauriDb.sqliteClearLibrary;
  sqliteResetProgress = tauriDb.sqliteResetProgress;
  sqliteGetSettings = tauriDb.sqliteGetSettings;
  sqliteSaveSettings = tauriDb.sqliteSaveSettings;
  exportBackup = tauriDb.exportBackup;
  restoreBackup = tauriDb.restoreBackup;
  validateBackup = tauriDb.validateBackup;
  validateRelativePath = tauriDb.validateRelativePath;
  matchingPosition = tauriDb.matchingPosition;
  parseSettings = tauriDb.parseSettings;

  // Indexing & background tasks
  indexTitle = tauriIndexing.indexTitle;
  prepareChapter = tauriIndexing.prepareChapter;
  previewChapters = tauriIndexing.previewChapters;
  scheduleBackground = tauriIndexing.scheduleBackground;
  stopBackground = tauriIndexing.stopBackground;
  stopAllBackground = tauriIndexing.stopAllBackground;
  resumeBackground = tauriIndexing.resumeBackground;

  // Window, config, diagnostics & updater
  setProgressBar = tauriApp.setProgressBar;
  showMainWindow = tauriApp.showMainWindow;
  getAppConfig = tauriApp.getAppConfig;
  saveAppConfig = tauriApp.saveAppConfig;
  setWindowPreferences = tauriApp.setWindowPreferences;
  setAppPreference = tauriApp.setAppPreference;
  getAppPreference = tauriApp.getAppPreference;
  recordOpenedRoot = tauriApp.recordOpenedRoot;
  getLastOpenedRoots = tauriApp.getLastOpenedRoots;
  onDragDrop = tauriApp.onDragDrop;
  checkForUpdate = tauriApp.checkForUpdate;
  installUpdate = tauriApp.installUpdate;
  getStorageStats = tauriApp.getStorageStats;
  saveFileDialog = tauriApp.saveFileDialog;
  recordDiagnostic = tauriApp.recordDiagnostic;
  getDiagnostics = tauriApp.getDiagnostics;
  clearDiagnostics = tauriApp.clearDiagnostics;
  sanitizeDiagnosticIdentifier = tauriApp.sanitizeDiagnosticIdentifier;
  computeOffsets = tauriApp.computeOffsets;
  getWindowRange = tauriApp.getWindowRange;
  sortLibraryEntries = tauriApp.sortLibraryEntries;
}
