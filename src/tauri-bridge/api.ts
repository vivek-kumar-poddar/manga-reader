import { isTauri } from './runtime';
import { TauriDesktopBridge } from './TauriBridge';
import { WebDesktopBridge } from './WebBridge';
import type { DesktopAPI } from './types';

export const desktopAPI: DesktopAPI = isTauri ? new TauriDesktopBridge() : new WebDesktopBridge();
