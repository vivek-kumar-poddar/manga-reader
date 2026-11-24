import { Channel } from '@tauri-apps/api/core';
import { invokeCommand } from './runtime';
import { parseFsError } from './errors';
import { cancelScan } from './tauriFs';
import type {
  IndexTitleOptions,
  IndexScanProgress,
  IndexTitleDto,
  PrepareChapterDto,
} from './types';

export async function indexTitle(
  root: string,
  options?: IndexTitleOptions,
  onProgress?: (progress: IndexScanProgress) => void,
): Promise<IndexTitleDto> {
  const channel = new Channel<IndexScanProgress>();
  const jobId =
    options?.jobId ??
    (options?.signal ? `index-${Math.random().toString(36).slice(2)}` : undefined);

  let abortHandler: (() => void) | undefined;
  if (options?.signal && jobId) {
    if (options.signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    abortHandler = () => {
      void cancelScan(jobId);
    };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }

  if (onProgress) {
    channel.onmessage = (progress) => {
      if (options?.signal?.aborted) {
        if (jobId) void cancelScan(jobId);
        return;
      }
      onProgress(progress);
    };
  }

  try {
    return await invokeCommand('index_title', {
      root,
      options: options
        ? {
            sort: options.sort,
            warmChapters: options.warmChapters,
            jobId,
            title: options.title,
            targetId: options.targetId ?? options.previous?.id,
            previous: options.previous
              ? {
                  id: options.previous.id,
                  title: options.previous.title,
                  slug: options.previous.slug,
                  lastChapter: options.previous.lastChapter,
                  addedAt: options.previous.addedAt,
                  revision: options.previous.revision,
                  chapters: options.previous.chapters.map((c) => ({
                    name: c.name,
                    read: c.read,
                    position: c.position,
                    bookmarks: c.bookmarks,
                    pages: c.pages.map((p) => ({
                      name: p.name,
                      path: p.path,
                      width: p.width,
                      height: p.height,
                      size: p.size,
                      modified: p.modified,
                      dimensionsPending: p.dimensionsPending,
                    })),
                  })),
                }
              : undefined,
          }
        : undefined,
      onProgress: channel,
    } as any);
  } catch (err) {
    const fsErr = parseFsError(err);
    if (
      fsErr?.code === 'Cancelled' ||
      (typeof err === 'string' && err.includes('Indexing cancelled')) ||
      (err instanceof Error && err.message.includes('Indexing cancelled'))
    ) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    throw err;
  } finally {
    if (abortHandler && options?.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
  }
}

export async function prepareChapter(
  mangaId: string,
  chapterIndex: number,
  onProgress?: (progress: IndexScanProgress) => void,
  signal?: AbortSignal,
): Promise<PrepareChapterDto> {
  const channel = new Channel<IndexScanProgress>();
  const jobId = signal ? `prep-${Math.random().toString(36).slice(2)}` : undefined;

  let abortHandler: (() => void) | undefined;
  if (signal && jobId) {
    if (signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    abortHandler = () => {
      void cancelScan(jobId);
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  if (onProgress) {
    channel.onmessage = (progress) => {
      if (signal?.aborted) {
        if (jobId) void cancelScan(jobId);
        return;
      }
      onProgress(progress);
    };
  }

  try {
    return await invokeCommand('prepare_chapter', {
      mangaId,
      chapterIndex,
      jobId,
      onProgress: channel,
    });
  } catch (err) {
    const fsErr = parseFsError(err);
    if (
      fsErr?.code === 'Cancelled' ||
      (typeof err === 'string' && err.includes('Indexing cancelled')) ||
      (err instanceof Error && err.message.includes('Indexing cancelled'))
    ) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    throw err;
  } finally {
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

export async function previewChapters(
  paths: string[],
): Promise<Array<{ name: string; pageCount: number }>> {
  return await invokeCommand('preview_chapters', { paths });
}

export async function scheduleBackground(
  mangaId: string,
  priorityChapter?: number,
): Promise<boolean> {
  try {
    return await invokeCommand('schedule_background', { mangaId, priorityChapter });
  } catch {
    return false;
  }
}

export async function stopBackground(mangaId: string): Promise<void> {
  try {
    await invokeCommand('stop_background', { mangaId });
  } catch {}
}

export async function stopAllBackground(): Promise<void> {
  try {
    await invokeCommand('stop_all_background');
  } catch {}
}

export async function resumeBackground(): Promise<number> {
  try {
    return await invokeCommand('resume_background');
  } catch {
    return 0;
  }
}
