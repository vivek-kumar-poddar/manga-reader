// Replace lines 1-14 in src/ImportComplete.tsx:
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpen, Download, X } from 'lucide-react';
import { getCover, type Manga, type Issue } from './data';
import { desktopAPI } from './tauriBridge';

function ImportedTitle({ manga, onClose }: { manga: Manga; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const chapters = manga.chapters.length;
  const pages = manga.chapters.reduce((n, c) => n + c.pages.length, 0);

  useEffect(() => {
    let live = true;
    let objectUrl = '';
    if (desktopAPI.isDesktop && desktopAPI.getCoverImageUrl) {
      setUrl(desktopAPI.getCoverImageUrl(manga.id, manga.updatedAt));
      return;
    }
    if (manga.cover) {
      objectUrl = URL.createObjectURL(manga.cover);
      setUrl(objectUrl);
    } else {
      void getCover(manga.id).then((blob) => {
        if (live && blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      });
    }
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [manga.id, manga.updatedAt, manga.cover]);

  return (
    <article className="import-success-title">
      <div className="import-success-cover">
        {url ? <img src={url} alt={manga.title + ' cover'} /> : <BookOpen size={42} />}
      </div>
      <div className="import-success-info">
        <h2>{manga.title}</h2>
        <dl>
          <div>
            <dt>Chapters</dt>
            <dd>{chapters.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{pages.toLocaleString()}</dd>
          </div>
        </dl>
        <button className="primary import-success-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </article>
  );
}
export default function ImportComplete({
  titles,
  issues,
  onClose,
  onExport,
  onRetry,
}: {
  titles: Manga[];
  issues: Issue[];
  onClose: () => void;
  onExport: () => void;
  onRetry: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="shortcuts-modal import-success-modal">
          <Dialog.Title className="sr-only">
            {titles.length ? 'Import complete' : 'Import needs attention'}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Review imported titles, chapter counts and page counts.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button className="close-btn import-success-close" aria-label="Close import result">
              <X size={20} />
            </button>
          </Dialog.Close>
          <div className="import-success-items">
            {titles.map((m) => (
              <ImportedTitle key={m.id} manga={m} onClose={onClose} />
            ))}
            {!titles.length && <h2>No titles were added</h2>}
          </div>
          {issues.length > 0 && (
            <details className="import-success-issues">
              <summary>
                {issues.length} {issues.length === 1 ? 'item needs' : 'items need'} attention
              </summary>
              <ul className="issue-list">
                {issues.slice(0, 100).map((issue, i) => (
                  <li key={i}>
                    <strong>{issue.path}</strong>
                    <span>{issue.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="button-row">
                <button className="secondary" onClick={onExport}>
                  <Download size={16} /> Download report
                </button>
                <button className="secondary" onClick={onRetry}>
                  Retry affected titles
                </button>
              </div>
            </details>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
