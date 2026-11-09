import { app, BrowserWindow, ipcMain, dialog, nativeImage, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In production the built Vite output lives in ../dist relative to this file.
const DIST_PATH = path.join(__dirname, '..', 'dist');
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const LOGO_PATH = path.join(__dirname, '..', 'logo', 'logo.png');
const DEV_URL = 'http://localhost:5173';

// Hardware acceleration with fallback:
// Enables GPU rasterization and zero-copy buffer transfers for smooth image scrolling.
// Respects --disable-gpu CLI flag for safe-mode troubleshooting.
if (!process.argv.includes('--disable-gpu')) {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

// Enforce single-instance lock to prevent concurrent processes from locking LevelDB/IndexedDB.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // Graceful GPU process fallback if GPU crashes or driver fails
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU' && details.reason !== 'clean-exit') {
      console.warn(
        `GPU process exited (${details.reason}, code: ${details.exitCode}). Chromium will fall back to software rendering.`,
      );
    }
  });

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  interface WindowState {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
  }

  function getWindowStateFile(): string {
    return path.join(app.getPath('userData'), 'window-state.json');
  }

  function loadWindowState(): WindowState {
    const defaults: WindowState = { width: 1280, height: 900 };
    try {
      const file = getWindowStateFile();
      if (!fs.existsSync(file)) return defaults;
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as WindowState;
      if (typeof data.width !== 'number' || typeof data.height !== 'number') return defaults;

      // Verify coordinates fall within an existing active display
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        const visible = screen.getAllDisplays().some((display) => {
          const { x, y, width, height } = display.bounds;
          return (
            data.x! >= x - 20 &&
            data.y! >= y - 20 &&
            data.x! < x + width - 100 &&
            data.y! < y + height - 100
          );
        });
        if (!visible) {
          delete data.x;
          delete data.y;
        }
      }
      return data;
    } catch {
      return defaults;
    }
  }

  function saveWindowState(win: BrowserWindow) {
    try {
      const isMaximized = win.isMaximized();
      const bounds = isMaximized && win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      };
      fs.writeFileSync(getWindowStateFile(), JSON.stringify(state));
    } catch {
      // Ignore save failures on exit
    }
  }

  function createWindow() {
    // Load the app icon from logo/logo.png.
    let icon: Electron.NativeImage | undefined;
    try {
      icon = nativeImage.createFromPath(LOGO_PATH);
    } catch {
      // Fall back to default icon if the file is missing.
    }

    const state = loadWindowState();

    const win = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: 480,
      minHeight: 600,
      title: 'Manga Reader',
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#18181b',
      ...(icon && !icon.isEmpty() ? { icon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: PRELOAD_PATH,
        backgroundThrottling: false,
      },
    });

    if (state.isMaximized) {
      win.maximize();
    }

    win.once('ready-to-show', () => {
      win.show();
    });

    win.on('close', () => {
      saveWindowState(win);
    });

    // Remove the default application menu (File/Edit/View/etc.).
    win.setMenu(null);

    // Lock visual zoom to 1:1 so Ctrl+wheel does not distort reader layouts.
    win.webContents.setVisualZoomLevelLimits(1, 1);

    // Prevent accidental Ctrl + '+' / '-' / '0' browser zoom.
    win.webContents.on('before-input-event', (event, input) => {
      if (
        input.control &&
        (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0')
      ) {
        event.preventDefault();
      }
    });

    // Prevent accidental file drag-and-drop navigation away from the app.
    win.webContents.on('will-navigate', (event, navigationUrl) => {
      if (process.env.NODE_ENV === 'development' && navigationUrl.startsWith(DEV_URL)) {
        return;
      }
      const indexFileUrl = pathToFileURL(path.join(DIST_PATH, 'index.html')).href;
      if (navigationUrl.startsWith(indexFileUrl) || navigationUrl.startsWith('file://')) {
        return;
      }
      event.preventDefault();
    });

    // Open any external web links in the user's default system browser.
    win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl.startsWith('https://') || targetUrl.startsWith('http://')) {
        void shell.openExternal(targetUrl);
      }
      return { action: 'deny' };
    });

    if (process.env.NODE_ENV === 'development') {
      win.loadURL(DEV_URL);
      // Open DevTools in dev for convenience; close manually if unwanted.
      win.webContents.openDevTools({ mode: 'detach' });
    } else {
      win.loadFile(path.join(DIST_PATH, 'index.html'));
    }
  }

  // Open a native folder picker. Returns the selected path or null if cancelled.
  ipcMain.handle('select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select manga folder',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  const ALLOWED_IMAGE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.avif',
    '.gif',
    '.bmp',
    '.svg',
    '.ico',
    '.heic',
    '.heif',
    '.tif',
    '.tiff',
    '.jxl',
  ]);

  const IGNORED_FOLDER_NAMES = new Set([
    '.git',
    '.svn',
    '.hg',
    'node_modules',
    '$recycle.bin',
    'system volume information',
  ]);

  const MAX_FILE_READ_BYTES = 100 * 1024 * 1024; // 100 MiB safety cap

  // Recursively list all image files under folderPath (depth-limited to 64 levels).
  // Returns relative paths using forward slashes, plus absolute paths.
  ipcMain.handle(
    'list-folder',
    (
      _event,
      folderPath: string,
    ): { relativePath: string; absolutePath: string; size: number; modified: number }[] => {
      if (typeof folderPath !== 'string' || !folderPath.trim()) return [];
      const resolvedRoot = path.resolve(folderPath.trim());
      try {
        if (!fs.statSync(resolvedRoot).isDirectory()) return [];
      } catch {
        return [];
      }

      const results: {
        relativePath: string;
        absolutePath: string;
        size: number;
        modified: number;
      }[] = [];

      function walk(dir: string, prefix: string, depth: number) {
        if (depth > 64 || results.length >= 100_000) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= 100_000) break;
          if (entry.isDirectory()) {
            if (IGNORED_FOLDER_NAMES.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) {
              continue;
            }
            const absPath = path.join(dir, entry.name);
            const relPath = prefix ? prefix + '/' + entry.name : entry.name;
            walk(absPath, relPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) continue;
            const absPath = path.join(dir, entry.name);
            const relPath = prefix ? prefix + '/' + entry.name : entry.name;
            try {
              const stat = fs.statSync(absPath);
              results.push({
                relativePath: relPath,
                absolutePath: absPath,
                size: stat.size,
                modified: stat.mtimeMs,
              });
            } catch {
              // skip unreadable files
            }
          }
        }
      }
      try {
        walk(resolvedRoot, '', 0);
      } catch {
        // return whatever was collected
      }
      return results;
    },
  );

  // Read a single file by absolute path asynchronously and return its bytes as an ArrayBuffer.
  // Using fs.promises.readFile runs in libuv's thread pool, avoiding blocking the main UI thread.
  // Validates file extension against allowed image formats and enforces a 100 MiB safety ceiling.
  ipcMain.handle('read-file', async (_event, absolutePath: string): Promise<ArrayBuffer | null> => {
    if (typeof absolutePath !== 'string' || !absolutePath.trim()) return null;
    const resolvedPath = path.resolve(absolutePath.trim());
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return null;
    }
    try {
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isFile() || stat.size > MAX_FILE_READ_BYTES) {
        return null;
      }
      const buffer = await fs.promises.readFile(resolvedPath);
      // Slice to get a plain ArrayBuffer that can be structured-cloned across IPC.
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch {
      return null;
    }
  });

  // Native taskbar progress bar during long-running imports or scans.
  // -1 removes, 0..1 sets fraction, >1 (e.g. 2) sets indeterminate mode on Windows.
  ipcMain.on('set-progress-bar', (event, progress: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setProgressBar(typeof progress === 'number' && Number.isFinite(progress) ? progress : -1);
    }
  });

  app.whenReady().then(createWindow);

  // Quit when all windows are closed (Windows/Linux behavior).
  app.on('window-all-closed', () => {
    app.quit();
  });

  // macOS: re-create window when dock icon is clicked and no windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
