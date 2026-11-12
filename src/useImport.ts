import { useState, useRef, useCallback, useEffect } from 'react';
import {
  warmSources,
  discardScan,
  indexSource,
  saveManga,
  scheduleBackground,
  getManga,
  errorMessage,
  type Source,
  type Summary,
  type Manga,
  type ScanState,
  type ScanOptions,
  type Issue,
} from './data';
import { type ImportPlan } from './ImportDialogs';
import { desktopAPI } from './tauriBridge';
import { recordDiagnostic } from './diagnostics';

export type ImportState =
  | { status: 'idle' }
  | { status: 'discovering'; scan: ScanState }
  | { status: 'preview'; preview: { sources: Source[]; target?: Manga } }
  | { status: 'indexing'; scan: ScanState }
  | {
      status: 'complete';
      report: {
        titles: Manga[];
        count: number;
        reused: number;
        issues: Issue[];
        retry: ImportPlan[];
      };
    }
  | { status: 'failed'; message: string };

export function useImport({
  onRefresh,
  onNotify,
}: {
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const activeOp = useRef<number>(0);
  const controller = useRef<AbortController | null>(null);
  const stagedSources = useRef<Source[]>([]);

  const cleanupStaged = useCallback(() => {
    if (stagedSources.current.length > 0) {
      discardScan(stagedSources.current);
      stagedSources.current = [];
    }
  }, []);

  const finish = useCallback(() => {
    controller.current = null;
    cleanupStaged();
    desktopAPI.setProgressBar(-1);
  }, [cleanupStaged]);

  const cancel = useCallback(() => {
    activeOp.current++;
    if (controller.current) {
      controller.current.abort();
    }
    finish();
    setState({ status: 'idle' });
  }, [finish]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (controller.current) {
        controller.current.abort();
      }
      cleanupStaged();
      desktopAPI.setProgressBar(-1);
    };
  }, [cleanupStaged]);

  const startOptions = useCallback((opId: number, phase: 'discover' | 'index'): ScanOptions => {
    controller.current = new AbortController();
    let last = 0;
    desktopAPI.setProgressBar(2);

    return {
      signal: controller.current.signal,
      update: (s: ScanState) => {
        if (activeOp.current !== opId) return;
        const now = performance.now();
        if (now - last > 80 || s.done === s.total) {
          last = now;
          setState((prev) => {
            if (phase === 'discover' && prev.status === 'discovering') {
              return { status: 'discovering', scan: s };
            }
            if (phase === 'index' && prev.status === 'indexing') {
              return { status: 'indexing', scan: s };
            }
            return prev;
          });
          if (s.total > 0) {
            desktopAPI.setProgressBar(Math.min(1, Math.max(0, s.done / s.total)));
          } else {
            desktopAPI.setProgressBar(2);
          }
        }
      },
    };
  }, []);

  const discover = useCallback(
    async (read: (options: ScanOptions) => Promise<Source[]>, target?: Summary | Manga) => {
      const opId = ++activeOp.current;
      cleanupStaged();
      setState({
        status: 'discovering',
        scan: { phase: 'discover', done: 0, total: 0, title: target?.title ?? '' },
      });

      const options = startOptions(opId, 'discover');
      let sources: Source[] = [];
      const startTime = performance.now();
      let outcome: 'preview' | 'failed' | 'cancelled' | 'idle' = 'idle';

      try {
        sources = await read(options);
        if (activeOp.current !== opId) return;
        stagedSources.current = sources;
        await warmSources(sources, options);
        if (activeOp.current !== opId) return;
        options.signal?.throwIfAborted();

        if (!sources.length) {
          throw new Error(
            'No supported image candidates found. Select folders with images, or extract archives first.',
          );
        }

        if (activeOp.current === opId) {
          const targetManga = target ? await getManga(target.id) : undefined;
          outcome = 'preview';
          setState({
            status: 'preview',
            preview: { sources, target: targetManga },
          });
        }
      } catch (e) {
        cleanupStaged();
        if (activeOp.current === opId) {
          const isAbort = e instanceof DOMException && e.name === 'AbortError';
          outcome = isAbort ? 'cancelled' : 'failed';
          const msg = isAbort ? 'Import cancelled. Existing data is unchanged.' : errorMessage(e);
          setState(isAbort ? { status: 'idle' } : { status: 'failed', message: msg });
          onNotify(msg);
          if (!isAbort) {
            recordDiagnostic({
              operation: 'import',
              level: 'warn',
              code: (e as any)?.name,
              message: msg,
              safeIdentifier: target?.title,
              durationMs: Math.round(performance.now() - startTime),
              retryable: true,
            });
          }
        }
      } finally {
        if (activeOp.current === opId && outcome !== 'preview') {
          desktopAPI.setProgressBar(-1);
        }
      }
    },
    [cleanupStaged, onNotify, startOptions],
  );

  const runImport = useCallback(
    async (plans: ImportPlan[]) => {
      const opId = ++activeOp.current;
      setState({
        status: 'indexing',
        scan: { phase: 'index', done: 0, total: 0, title: plans[0]?.source.title ?? '' },
      });

      const options = startOptions(opId, 'index');
      const issues: Issue[] = [];
      const retry: ImportPlan[] = [];
      const titles: Manga[] = [];
      let count = 0;
      let reused = 0;
      const startTime = performance.now();

      try {
        for (const plan of plans) {
          if (activeOp.current !== opId) break;
          options.signal?.throwIfAborted();
          try {
            const previous = plan.targetId ? await getManga(plan.targetId) : undefined;
            const result = await indexSource(plan.source, options, previous, plan.sort);
            if (activeOp.current !== opId || options.signal?.aborted) {
              break;
            }
            await saveManga(result.m);
            count++;
            titles.push(result.m);
            scheduleBackground(result.m);
            reused += result.reused;
            issues.push(
              ...result.issues.map((i) => ({ ...i, path: plan.source.title + '/' + i.path })),
            );
            if (result.issues.length) {
              retry.push({ ...plan, targetId: result.m.id });
            }
          } catch (e) {
            if (activeOp.current !== opId || options.signal?.aborted) {
              break;
            }
            options.signal?.throwIfAborted();
            const msg = errorMessage(e);
            issues.push({ path: plan.source.title, reason: msg });
            retry.push(plan);
            recordDiagnostic({
              operation: 'import',
              level: 'error',
              code: (e as any)?.name,
              message: msg,
              safeIdentifier: plan.source.title,
              retryable: true,
            });
          }
        }

        await onRefresh();
        if (activeOp.current === opId) {
          setState({
            status: 'complete',
            report: { titles, count, reused, issues, retry },
          });
        }
      } catch (e) {
        await onRefresh();
        if (activeOp.current === opId) {
          const isAbort = e instanceof DOMException && e.name === 'AbortError';
          const msg = isAbort
            ? `Import cancelled. ${count} completed titles saved; the unfinished title was not changed.`
            : errorMessage(e);
          setState(isAbort ? { status: 'idle' } : { status: 'failed', message: msg });
          onNotify(msg);
          if (!isAbort) {
            recordDiagnostic({
              operation: 'import',
              level: 'error',
              code: (e as any)?.name,
              message: msg,
              durationMs: Math.round(performance.now() - startTime),
              retryable: true,
            });
          }
        }
      } finally {
        discardScan(plans.map((p) => p.source));
        if (activeOp.current === opId) {
          finish();
        }
      }
    },
    [finish, onNotify, onRefresh, startOptions],
  );

  const dismiss = useCallback(() => {
    cleanupStaged();
    setState({ status: 'idle' });
  }, [cleanupStaged]);

  return {
    state,
    isBusy: state.status === 'discovering' || state.status === 'indexing',
    scanState:
      state.status === 'discovering' || state.status === 'indexing'
        ? state.scan
        : { phase: 'discover' as const, done: 0, total: 0, title: '' },
    discover,
    runImport,
    cancel,
    dismiss,
  };
}
