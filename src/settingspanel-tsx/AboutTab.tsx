import { APP_VERSION } from '../updates';

export default function AboutTab() {
  return (
    <>
      <section>
        <h3>
          Reader <span className="subtle">{APP_VERSION}</span>
        </h3>
        <p>
          A private local manga reader for folders on your device. No account or external service
          required.
        </p>
      </section>
      <section>
        <h3>Organize your folders</h3>
        <p>
          Drop or select a title folder, collection folder, or multiple folders. Root images form
          one chapter; subfolders become naturally sorted chapters.
        </p>
        <p>
          Place a <code>thumbnail.png</code> or <code>thumbnail.jpg</code> in a title root for a
          custom cover, or Reader uses the first page.
        </p>
      </section>
      <section>
        <h3>Fast, staged indexing</h3>
        <p>
          The first 20 chapters prepare immediately, and remaining chapters finish in the background
          with priority around your active chapter. Cached page dimensions keep scrolling, spreads,
          and saved positions steady.
        </p>
      </section>
      <section>
        <h3>Folder access &amp; relinking</h3>
        <p>
          If a folder moves or permission expires, choose Re-link on the title. Unchanged dimensions
          and reading progress are preserved by page path.
        </p>
      </section>
      <section>
        <h3>Reader controls</h3>
        <p>
          Open the info icon in the reader header for keyboard shortcuts. Swipe left/right in
          single-page mode, or hover/tap screen edges to show auto-hidden bars.
        </p>
      </section>
    </>
  );
}
