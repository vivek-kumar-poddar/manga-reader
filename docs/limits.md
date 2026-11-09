# Operational limits — step 03

Source of truth: `src/limits.ts`. Shared types/defaults: `src/model.ts`.
`src/data.ts` re-exports the old model names for compatibility. Importing model or
limits performs no database, DOM, or service-worker work. Database version stays 2.

## Policy and units

Limits are inclusive. Counts measure entries, bytes measure Blob/File bytes,
paths measure JavaScript UTF-16 code units, dimensions measure integer pixels,
and durations measure milliseconds. Resource violations use `LimitError` with a
named resource/maximum; they never silently truncate imported metadata.

| Constant               |             Maximum | Enforcement / rationale                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| backupBytes            | 33,554,432 (32 MiB) | Check before `File.text()`/JSON.parse; bounds the raw metadata input, not parsed heap.                                                                                                                                                                                                                                             |
| titles                 |               1,000 | Backup/selection/split count; transactional new-title capacity check; updates allowed at capacity.                                                                                                                                                                                                                                 |
| chaptersPerTitle       |               1,000 | Source grouping, backup parsing, metadata writes. Empty chapters cannot multiply work during import.                                                                                                                                                                                                                               |
| pagesPerTitle          |             100,000 | Includes image candidates during discovery; all chapters combined. Raised from 10,000: a lower ceiling rejects valid large manga titles (e.g. 25,000+ pages) without preventing a real resource problem, since pages are lazy-loaded at 1-2 concurrent jobs. Bounded to prevent runaway inputs, not to cap legitimate collections. |
| backupPages            |           1,000,000 | Sum across backup titles; raised proportionally (10× per-title ceiling) so the cross-title guard stays meaningful without blocking single large-title backup restore.                                                                                                                                                              |
| bookmarksPerChapter    |               1,000 | Backup/write checks and reader add action; removing bookmarks remains available at capacity.                                                                                                                                                                                                                                       |
| pathChars              |               4,096 | Relative file path, checked before traversal; generous headroom over ordinary fixture paths.                                                                                                                                                                                                                                       |
| directoryDepth         |                  64 | Preserves original traversal depth; root files have depth 0. Native/legacy discovery reports deeper branches and skips them, as before. File/backup paths exceeding it are rejected.                                                                                                                                               |
| discoveryEntries       |             100,000 | Counts all enumerated entries, including ignored files; per native tree / combined legacy drop; selected-file count and aggregate candidate-image count also capped. Prevents ignored/repeated entries bypassing limits.                                                                                                           |
| imagePixels            |          16,000,000 | Optional bitmap resize and known-header cover budget. Larger originals remain readable; this is not a source-image limit.                                                                                                                                                                                                          |
| imageSide              |              32,768 | Optional bitmap resize and known-header cover axis budget. Long source panels are accepted.                                                                                                                                                                                                                                        |
| queuedJobs             |                  64 | Separate discovery, reader, background queues. Small fixed backlog, unrelated to total library size.                                                                                                                                                                                                                               |
| decodeConcurrency      |                   3 | Preserves indexing/discovery worker count.                                                                                                                                                                                                                                                                                         |
| mobilePageConcurrency  |                   1 | Preserves reader worker count at <=700px.                                                                                                                                                                                                                                                                                          |
| desktopPageConcurrency |                   4 | Reader worker count above 700px (raised from 2 for desktop/Electron fast preloading).                                                                                                                                                                                                                                              |
| headerBytes            |   262,144 (256 KiB) | Preserves bounded header reads; JPEG marker scan never reads beyond that buffer.                                                                                                                                                                                                                                                   |
| imageTimeoutMs         |              20,000 | Preserves fallback image deadline; also bounds resize/encode waits.                                                                                                                                                                                                                                                                |
| coverTimeoutMs         |              10,000 | Preserves cover decoding deadline; also bounds encoding.                                                                                                                                                                                                                                                                           |
| ioTimeoutMs            |              20,000 | File/header/backup reads, folder iteration, permission checks, legacy callbacks. Uses the existing image wait budget as conservative initial policy.                                                                                                                                                                               |
| updateTimeoutMs        |              10,000 | Preserves save-before-update and worker-activation deadlines/messages.                                                                                                                                                                                                                                                             |
| warmChapters           |                   5 | Preserves the staged-import preparation window.                                                                                                                                                                                                                                                                                    |

Step-01 measurements came from one desktop with 68 GB RAM and synthetic SVGs.
They justify retaining the existing worker counts and support the 1,000-page
regression fixture. They cannot establish safe peak memory on phones. New ceilings
are conservative engineering choices with stated headroom; retune only after
real-device measurements. No new framework, runtime dependency, or worker added.

## Queue and failure behavior

- Discovery retains at most 64 waiting decode jobs and 3 active task promises;
  a full queue pauses discovery until a worker finishes. Completed promises leave
  the task Set immediately. Resource-limit errors stop the scan before commit;
  unreadable individual pages still appear in the existing issue report.
  Root cover files do not consume an extra chapter slot; legacy traversal counts
  folder levels without counting the leaf file as an additional level.
- Reader retains 64 waiting jobs plus 1/2 active jobs. Overflow displays a retry
  action for that page. Removable jobs, deduplication and viewport priority remain
  step 12; this step establishes the hard capacity only.
- Background retains at most 64 title jobs, including its current job. Overflow
  stays marked pending in IndexedDB and is prepared when opened or on a later
  resume. Each drain pass processes at most its initial job count; arrivals run
  in a later task. Lightweight job records remain step 10.
- `withinTime` clears its timer/abort listener, settles once, handles undefined
  rejection reasons, and consumes late failures. It stops waiting, not underlying
  browser operations with no cancellation API. Late resized bitmaps are closed.
- Known PNG/GIF/JPEG dimensions are checked before decoding. Other formats are
  checked after browser decoding; no claim is made that their peak allocation is
  prevented. Full image cleanup/preflight remains step 13.
- No existing database data is deleted or truncated. Oversized legacy records
  may be read/exported, but new import/write/prepare operations must fit policy.
  Old-library export streaming/partitioning remains step 16; a legacy export
  above these ceilings cannot be restored as one new backup.

## Loop termination audit

| Processing family                   | Exit bound                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native discovery                    | <=100,000 entries/tree; each iterator `next`/`return` has an I/O deadline; recursion depth <=64.                                                                                       |
| Legacy discovery                    | Empty batch exits; every nonempty batch consumes the <=100,000-entry budget; callbacks have deadlines; recursion depth <=64.                                                           |
| Decode backpressure/drain           | Finite source list; <=64 waiting +3 active; each read/header/decode wait settles on completion, failure, timeout or supported cancellation.                                            |
| Pooled preparation                  | Monotonic index `< items.length`; <=3 workers; title input capped.                                                                                                                     |
| Reader queue pump                   | Each iteration removes a job and increments active until 1/2; pending queue <=64.                                                                                                      |
| Background drain                    | Captured initial job count <=64; finite chapter lists; explicit later-task continuation for new arrivals.                                                                              |
| Slug allocation                     | <=used.size + reserved.length +1 candidates; same suffixes as before.                                                                                                                  |
| JPEG marker parsing                 | Monotonic byte offset; bounded header buffer; invalid length/end marker exits.                                                                                                         |
| Backup, grouping, sorting, matching | Finite arrays/maps; import counts/path lengths checked; backup total-page counter limits nested expansion.                                                                             |
| Existing DB migration/list/delete   | Finite IndexedDB cursor/key snapshots and chapter arrays. Migration rollback and validation of old stored records remain steps 07/05. No old records silently dropped to fit new caps. |
| Reader grouping/search/autoplay     | Page index increments or binary-search interval shrinks; animation loop exits when frame time is consumed or page list ends. Each later frame is a separate scheduled task.            |
| UI effects/observers                | Finite event batches; repeated work is event/timer driven. Disposal audit remains step 18.                                                                                             |

Full unknown-record validation/allowlisting, duplicate keys, atomic restore, and
save durability remain steps 04/08/09. These count/resource guards do not replace
those protections.
