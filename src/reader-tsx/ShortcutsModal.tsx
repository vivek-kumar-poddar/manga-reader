import { Modal } from '../ImportDialogs';

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Reader shortcuts work when a control or popup is not focused."
    >
      <table className="shortcuts-table">
        <tbody>
          {[
            ['Space', 'Start / pause auto-scroll or page playback'],
            [
              '← / →',
              'Turn pages (follows reading direction), or change chapters in continuous mode',
            ],
            ['B', 'Bookmark / unbookmark the current page'],
            ['Escape', 'Stop auto-scroll and show bars; close an open popup first'],
            ['↑ / ↓ · Page Up / Down', 'Browser scrolling'],
            ['Home / End', 'Browser navigation to top / bottom'],
            ['Tab / Shift + Tab', 'Focus next / previous control'],
            ['Enter / Space', 'Activate a focused button'],
            ['← / → · Home / End', 'Switch tabs when a settings tab is focused'],
          ].map(([key, value]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="subtle">
        Pinch to zoom and pan on touch devices. Page swipes are disabled while zoomed. Open the
        percentage control at the bottom right to adjust zoom. Drag the center progress bar to jump
        between pages.
      </p>
    </Modal>
  );
}
