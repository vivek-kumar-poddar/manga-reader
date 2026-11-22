import { Link } from 'react-router-dom';

export function ChapterEnd({
  isLastChapter,
  onNextChapter,
  onReadAgain,
}: {
  isLastChapter: boolean;
  onNextChapter: () => void;
  onReadAgain: () => void;
}) {
  return (
    <div className="chapter-end">
      <h2>{isLastChapter ? 'You’re all caught up.' : 'Chapter complete.'}</h2>
      <div className="button-row">
        {!isLastChapter && (
          <button className="btn primary" onClick={onNextChapter}>
            Next chapter
          </button>
        )}
        <button className="btn secondary" onClick={onReadAgain}>
          Read again
        </button>
        <Link className="btn secondary" to="/">
          Library
        </Link>
      </div>
    </div>
  );
}
