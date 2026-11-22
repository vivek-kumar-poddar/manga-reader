import { Sun, Moon } from 'lucide-react';
import { useApp } from './AppContext';
import { IconButton } from './IconButton';

export function ThemeButton() {
  const { settings, setSettings } = useApp();
  return (
    <IconButton
      label="Toggle light / dark theme"
      onClick={() =>
        setSettings({
          ...settings,
          theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark',
        })
      }
    >
      {settings.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
    </IconButton>
  );
}
