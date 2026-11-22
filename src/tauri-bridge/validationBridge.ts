import type { Manga, Settings } from '../model';
import { desktopAPI } from './api';
import {
  parseSettings as parseSettingsSync,
  validateBackup as validateBackupSync,
  ValidationError,
  isRecord,
  validateRelativePath,
  matchingPosition,
  parsePosition,
  parsePage,
  parseChapter,
  parseManga,
  parseSummary,
  parseSettings,
  validateBackup,
} from '../web/validation';

export {
  ValidationError,
  isRecord,
  validateRelativePath,
  matchingPosition,
  parsePosition,
  parsePage,
  parseChapter,
  parseManga,
  parseSummary,
  parseSettings,
  validateBackup,
};

export async function validateBackupAsync(
  value: unknown,
): Promise<{ manga: Manga[]; settings: Settings }> {
  const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
  if (desktopAPI.validateBackup) {
    const validated = (await desktopAPI.validateBackup(jsonStr)) as {
      manga: Manga[];
      settings: Settings;
    };
    return {
      manga: validated.manga || [],
      settings: parseSettingsSync(validated.settings),
    };
  }
  return validateBackupSync(value);
}
