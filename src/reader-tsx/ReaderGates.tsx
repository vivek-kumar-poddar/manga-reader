import { Link } from 'react-router-dom';
import { BookOpen, FolderSync, LoaderCircle } from 'lucide-react';
import { mangaDetailsPath } from '../paths';
import type { Manga } from '../data';

export function IndexingGate({
  progress,
  onCancel,
}: {
  progress: [number, number];
  onCancel: () => void;
}) {
  return (
    <main className="reader-gate">
      <LoaderCircle className="spin" />
      <h1>
        {progress[0]} / {progress[1] || '…'}
      </h1>
      <p>Updating your folder index. Saved reading progress is preserved.</p>
      <button className="btn secondary" onClick={onCancel}>
        Cancel import
      </button>
    </main>
  );
}

export function LoadingGate({ message = 'Opening your pages…' }: { message?: string }) {
  return (
    <main className="reader-gate">
      <LoaderCircle className="spin" />
      <p>{message}</p>
    </main>
  );
}

export function NotFoundGate() {
  return (
    <main className="reader-gate">
      <BookOpen size={32} />
      <h1>This title isn’t in your library.</h1>
      <Link className="btn primary" to="/">
        Back to library
      </Link>
    </main>
  );
}

export function NoPagesGate({ manga }: { manga: Manga }) {
  return (
    <main className="reader-gate">
      <BookOpen size={32} />
      <h1>No readable pages in this title</h1>
      <p>"{manga.title || 'Untitled'}" does not contain any readable chapter or page data.</p>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
        <Link className="btn primary" to="/">
          Back to library
        </Link>
        <Link className="btn secondary" to={mangaDetailsPath(manga)}>
          Title details
        </Link>
      </div>
    </main>
  );
}

export function RelinkGate({ manga, onRelink }: { manga: Manga; onRelink: () => void }) {
  return (
    <main className="reader-gate">
      <FolderSync size={32} />
      <h1>Your story is still here.</h1>
      <p>Re-link “{manga.title}” to continue from your saved page.</p>
      <p>
        {manga.handle
          ? 'Your browser needs permission to read this folder again. Choose “Allow on every visit” in the browser prompt, if offered, to remember access.'
          : 'This folder was added with temporary access. Choose the same folder again; your saved progress is kept. For remembered access, use Choose a folder in a browser that supports it.'}
      </p>
      <button className="btn primary" onClick={onRelink}>
        Re-link folder
      </button>
      <Link className="text-button" to="/">
        Back to library
      </Link>
    </main>
  );
}

export function PreparingGate({
  chapterName,
  done,
  total,
}: {
  chapterName: string;
  done: number;
  total: number;
}) {
  return (
    <main className="reader-gate">
      <LoaderCircle className="spin" />
      <h2>Preparing {chapterName}</h2>
      <p>
        {done} / {total} page sizes checked. This chapter is prepared once and saved on this device.
      </p>
      <Link className="btn secondary" to="/">
        Back to library
      </Link>
    </main>
  );
}
