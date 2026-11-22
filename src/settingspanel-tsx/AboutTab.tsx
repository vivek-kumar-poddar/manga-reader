import { APP_VERSION } from '../updates';

export default function AboutTab() {
  return (
    <>
      <section>
        <h3>
          Reader <span className="subtle">{APP_VERSION}</span>
        </h3>
        <p>
          A private reader for the manga folders already on your device. No account or
          external service is needed for reading your local pages.
        </p>
      </section>
      <section>
        <h3>Organize your folders</h3>
        <p>
          Choose a title folder, a parent collection, or several dropped folders. Review
          the detected grouping before importing. Images directly in the root become one
          chapter; nested folder paths become chapter labels.
        </p>
        <p>
          Natural sorting handles numbered chapters and decimals. You can choose filename
          or reverse order in the import preview. Hidden/system files and non-image files
          are ignored; inaccessible folders and unreadable images encountered during
          initial preparation are listed in the import report. Empty folders contain no
          pages and are omitted.
        </p>
        <p>
          Add a file named thumbnail.png, thumbnail.jpg, or another supported image format
          in the root for a cover. Otherwise, Reader uses the first readable page.
        </p>
      </section>
      <section>
        <h3>Faster, staged indexing</h3>
        <p>
          Reader discovers folders and prepares image sizes together in one scan. The
          first five chapters are prepared before you confirm import. These measurements
          stay temporary until you add the title; cancelling discards them. Changing
          grouping or sorting updates the preparation before the Import button becomes
          available.
        </p>
        <p>
          Page dimensions keep scrolling, page fitting, two-page spreads, and saved
          reading positions stable. Common image sizes are read from small file headers
          instead of decoding the entire image. Other formats use the browser decoder,
          with at most three checks running together.
        </p>
        <p>
          After a title is saved, remaining chapters continue preparing quietly in the
          background. Opening an unfinished chapter gives it priority. Completed
          dimensions are cached locally; pending work resumes on a later visit when folder
          access is available. Removing a title stops its background work. Unreadable
          pages remain available for retry and show an error when opened.
        </p>
      </section>
      <section>
        <h3>Folder access & reading</h3>
        <p>
          In the browser’s folder permission prompt, choose “Allow on every visit”, if
          offered, to avoid granting access each session. “Allow this time” is temporary.
          The browser controls these choices; Reader cannot force permanent access or make
          all options appear again.
        </p>
        <p>
          To change a previous choice, open the browser’s address-bar site controls and
          review its file or folder permissions. Then return to Reader and open a title to
          request access again. Available options depend on your browser and previous
          choices. Keep this site’s stored data to preserve your library and progress.
        </p>
        <p>
          Where supported, direct folder selection can retain access with your permission.
          Embedded views and other browsers use standard folder selection and need
          re-linking after a reload. Saved indexing and progress remain.
        </p>
        <p>
          When folders move or permission expires, use Re-link / re-index on the title.
          Reader reuses unchanged dimensions and restores progress by page path. Renamed
          chapters with uniquely matching page metadata can keep progress. A mismatched
          selection requires explicit confirmation in the import preview.
        </p>
      </section>
      <section>
        <h3>Reader controls</h3>
        <p>
          The information icon beside the theme button lists keyboard shortcuts. In
          single-page mode, swipe left or right to turn a page. With auto-hide enabled,
          tap near a screen edge to bring controls back.
        </p>
      </section>
    </>
  );
}
