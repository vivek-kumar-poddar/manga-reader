import Dropdown from './Dropdown';
import { useEffect, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Folder, FileImage } from 'lucide-react';
import {
  warmSources,
  chapterGroups,
  splitSource,
  getManga,
  type Source,
  type Summary,
  type Manga,
} from './data';
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="shortcuts-modal import-modal">
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-btn" aria-label="Close popup">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Tabs({
  names,
  value,
  onChange,
  id,
}: {
  names: string[];
  value: number;
  onChange: (i: number) => void;
  id: string;
}) {
  return (
    <div className="settings-tabs example-tabs" role="tablist" aria-label={id}>
      {names.map((n, i) => (
        <button
          key={n}
          type="button"
          role="tab"
          id={id + '-' + i}
          aria-selected={value === i}
          aria-controls={id + '-panel'}
          tabIndex={value === i ? 0 : -1}
          onClick={() => onChange(i)}
          onKeyDown={(e) => {
            const next =
              e.key === 'ArrowRight'
                ? (i + 1) % names.length
                : e.key === 'ArrowLeft'
                  ? (i + names.length - 1) % names.length
                  : e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? names.length - 1
                      : -1;
            if (next < 0) return;
            e.preventDefault();
            onChange(next);
            document.getElementById(id + '-' + next)?.focus();
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
type Node = { name: string; children?: Node[] };
const examples: { title: string; tree: Node[]; text: string }[] = [
  {
    title: 'Pages in one folder',
    tree: [
      {
        name: 'My manga',
        children: [{ name: '001.jpg' }, { name: '002.png' }, { name: '003.webp' }],
      },
    ],
    text: 'Select My manga. Choose One title in the import preview. All images become one chapter called Root pages. You can also select individual images.',
  },
  {
    title: 'One folder per chapter',
    tree: [
      {
        name: 'My manga',
        children: [
          { name: 'thumbnail.jpg' },
          { name: 'Chapter 1', children: [{ name: '001.jpg' }, { name: '002.jpg' }] },
          { name: 'Chapter 2', children: [{ name: '001.jpg' }] },
        ],
      },
    ],
    text: 'Select My manga and keep One title. Each image-containing folder becomes a chapter. A root thumbnail or cover image supplies the cover preview.',
  },
  {
    title: 'Volumes containing chapters',
    tree: [
      {
        name: 'My manga',
        children: [
          {
            name: 'Volume 1',
            children: [
              { name: 'Chapter 1', children: [{ name: '001.jpg' }] },
              { name: 'Chapter 2', children: [{ name: '001.jpg' }] },
            ],
          },
          { name: 'Volume 2', children: [{ name: 'Chapter 1', children: [{ name: '001.jpg' }] }] },
        ],
      },
    ],
    text: 'Select My manga and keep One title. Chapter labels retain their complete group path, such as Volume 1 / Chapter 1. Choose natural, filename, or reverse ordering in the preview.',
  },
  {
    title: 'A parent folder with several manga',
    tree: [
      {
        name: 'My collection',
        children: [
          { name: 'Manga A', children: [{ name: 'Chapter 1', children: [{ name: '001.jpg' }] }] },
          { name: 'Manga B', children: [{ name: 'Chapter 1', children: [{ name: '001.jpg' }] }] },
        ],
      },
    ],
    text: 'Select My collection, then choose Multiple titles in the import preview. Each immediate subfolder becomes a separate title. You can review every title before importing.',
  },
  {
    title: 'Mixed folder depths',
    tree: [
      {
        name: 'My manga',
        children: [
          { name: 'opening.jpg' },
          {
            name: 'Chapter 1',
            children: [{ name: '001.jpg' }, { name: 'Extras', children: [{ name: 'bonus.png' }] }],
          },
          { name: 'Chapter 2', children: [{ name: '001.jpg' }] },
        ],
      },
    ],
    text: 'Choose One title. Root pages, Chapter 1, Chapter 1 / Extras, and Chapter 2 become separate chapters. Images are never silently merged across folders. The preview shows the grouping.',
  },
  {
    title: 'Multiple dropped folders or selected images',
    tree: [
      { name: 'Manga A', children: [{ name: '001.jpg' }, { name: '002.jpg' }] },
      { name: 'Manga B', children: [{ name: 'Chapter 1', children: [{ name: '001.jpg' }] }] },
      { name: 'Loose selected images', children: [{ name: 'page-1.png' }, { name: 'page-2.png' }] },
    ],
    text: 'Drop multiple folders together to import separate titles. Loose images form one title named Selected images, which you can rename before importing. ZIP, CBZ, RAR, PDF, and encrypted archives are not imported; extract their images first.',
  },
];
function Tree({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="folder-tree">
      {nodes.map((n, i) => (
        <li key={n.name + i}>
          <span>
            {n.children ? <Folder size={16} /> : <FileImage size={15} />} {n.name}
          </span>
          {n.children && <Tree nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}
export function SupportedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const example = examples[tab];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What’s supported"
      description="Choose the arrangement that matches your files. Your folders and originals stay unchanged."
    >
      <Tabs
        names={examples.map((_, i) => 'Ex ' + (i + 1))}
        value={tab}
        onChange={setTab}
        id="folder-examples"
      />
      <div
        id="folder-examples-panel"
        role="tabpanel"
        aria-labelledby={'folder-examples-' + tab}
        className="example-body"
      >
        <h3>{example.title}</h3>
        <Tree nodes={example.tree} />
        <p>{example.text}</p>
      </div>
      <div className="support-note">
        <p>
          JPG, PNG, WebP, GIF, AVIF, BMP, SVG, and other image formats are accepted when your
          browser can decode them. HEIC and TIFF support depends on the browser. Unsupported or
          unreadable files appear in the import report.
        </p>
        <p>
          Hidden/system files are ignored. Folder discovery supports up to 64 nested levels.
          Standard file selection requires re-linking after reloading; your saved progress remains.
        </p>
      </div>
    </Modal>
  );
}
export interface ImportPlan {
  source: Source;
  targetId?: string;
  sort: Manga['sort'];
}
export function ImportDialog({
  sources,
  target,
  library,
  onClose,
  onImport,
}: {
  sources: Source[];
  target?: Manga;
  library: Summary[];
  onClose: () => void;
  onImport: (plans: ImportPlan[]) => void;
}) {
  const [modes, setModes] = useState<boolean[]>(sources.map(() => false));
  const [plans, setPlans] = useState<ImportPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void (async () => {
      const list: ImportPlan[] = [];
      for (let i = 0; i < sources.length; i++) {
        const children = modes[i] ? await splitSource(sources[i]) : [sources[i]];
        for (const source of children) {
          let duplicate: Summary | undefined;
          for (const candidate of library) {
            if (source.handle && candidate.handle) {
              try {
                if (await source.handle.isSameEntry(candidate.handle)) {
                  duplicate = candidate;
                  break;
                }
              } catch {
                /* Compare metadata below when handle identity is unavailable. */
              }
            }
          }
          list.push({
            source,
            targetId: target?.id || duplicate?.id,
            sort: target?.sort || 'natural',
          });
        }
      }
      if (live) {
        setPlans(list);
        setLoading(false);
      }
    })().catch(() => {
      if (live) {
        setError('Could not prepare the import preview. Re-select the folders.');
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [sources, modes]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setConfirmed(false);
    setMismatch(false);
    setChecking(true);
    void (async () => {
      for (const plan of plans) {
        await warmSources([plan.source], { signal: controller.signal }, plan.sort);
        if (!plan.targetId) continue;
        const previous = target?.id === plan.targetId ? target : await getManga(plan.targetId);
        if (!previous) continue;
        const oldPages = previous.chapters.flatMap((c) => c.pages);
        const sample = oldPages
          .filter((_, i) => i % Math.max(1, Math.floor(oldPages.length / 24)) === 0)
          .slice(0, 24);
        let matched = 0;
        for (const page of sample) {
          const candidate = plan.source.files.get(page.path);
          if (!candidate) continue;
          try {
            const file = candidate instanceof File ? candidate : await candidate.getFile();
            if (
              page.size !== undefined &&
              page.size === file.size &&
              page.modified === file.lastModified
            )
              matched++;
          } catch {
            /* Unreadable candidates require confirmation and appear in the import report. */
          }
        }
        if (
          (previous.title !== plan.source.title ||
            matched < sample.length * 0.5 ||
            !sample.length) &&
          live
        )
          setMismatch(true);
      }
    })()
      .catch(() => {
        if (live) setMismatch(true);
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [plans]);

  const duplicateTargets = plans.some(
    (p, i) => p.targetId && plans.some((q, j) => j < i && q.targetId === p.targetId),
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Review your import"
      description="Check the grouping and sorting before saving. Existing titles are changed only when you choose to update them."
    >
      {!target &&
        sources.map((source, i) => (
          <label className="import-choice" key={i}>
            <span>{source.title}</span>
            <Dropdown
              aria-label={'Folder grouping for ' + source.title}
              value={modes[i] ? 'collection' : 'single'}
              onChange={(e) =>
                setModes((m) => m.map((v, j) => (j === i ? e.target.value === 'collection' : v)))
              }
            >
              <option value="single">One title</option>
              <option value="collection">Multiple titles (one per subfolder)</option>
            </Dropdown>
          </label>
        ))}
      {loading ? (
        <p>Preparing folder preview…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        plans.map((plan, i) => {
          const groups = [...chapterGroups(plan.source)];
          return (
            <section className="import-preview" key={i}>
              <label>
                Title
                <input
                  value={plan.source.title}
                  onChange={(e) =>
                    setPlans((p) =>
                      p.map((v, j) =>
                        j === i ? { ...v, source: { ...v.source, title: e.target.value } } : v,
                      ),
                    )
                  }
                />
              </label>
              <div className="import-options">
                <label>
                  Save as
                  <Dropdown
                    aria-label="Save as"
                    value={plan.targetId || 'new'}
                    onChange={(e) =>
                      setPlans((p) =>
                        p.map((v, j) =>
                          j === i
                            ? {
                                ...v,
                                targetId: e.target.value === 'new' ? undefined : e.target.value,
                              }
                            : v,
                        ),
                      )
                    }
                  >
                    <option value="new">Add separate title</option>
                    {library.map((m) => (
                      <option key={m.id} value={m.id}>
                        Update: {m.title} · {m.chapterCount} chapters
                      </option>
                    ))}
                  </Dropdown>
                </label>
                <label>
                  Sort
                  <Dropdown
                    aria-label="Sort"
                    value={plan.sort}
                    onChange={(e) =>
                      setPlans((p) =>
                        p.map((v, j) =>
                          j === i ? { ...v, sort: e.target.value as Manga['sort'] } : v,
                        ),
                      )
                    }
                  >
                    <option value="natural">Natural chapter order</option>
                    <option value="name">Filename order</option>
                    <option value="reverse">Reverse natural order</option>
                  </Dropdown>
                </label>
              </div>
              <details>
                <summary>
                  {groups.length} chapters · {plan.source.files.size} candidate images — view
                  grouping
                </summary>
                <ul>
                  {groups.map(([name, count]) => (
                    <li key={name}>
                      {name}
                      <span>{count} pages</span>
                    </li>
                  ))}
                </ul>
              </details>
              {plan.source.issues.length > 0 && (
                <details>
                  <summary>{plan.source.issues.length} discovery issues</summary>
                  <ul>
                    {plan.source.issues.slice(0, 30).map((issue, n) => (
                      <li key={n}>
                        {issue.path}: {issue.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })
      )}
      {mismatch && (
        <label className="match-warning">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          The name or page list differs from the saved title. I confirm this is the correct
          replacement folder.
        </label>
      )}
      {duplicateTargets && (
        <p role="alert">
          Two imports target the same saved title. Choose different targets or add them separately.
        </p>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={
            loading ||
            checking ||
            !!error ||
            !plans.length ||
            plans.some((p) => !p.source.title.trim() || !chapterGroups(p.source).size) ||
            duplicateTargets ||
            (mismatch && !confirmed)
          }
          onClick={() => onImport(plans)}
        >
          Import {plans.length} {plans.length === 1 ? 'title' : 'titles'}
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
