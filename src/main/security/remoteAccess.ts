/** The current remote access settings, for the guards (read on every request) */
import { getConfig } from '../utils/config';
import type { RemoteAccessSettings } from './accessKey';

export function remoteAccessSettings(): RemoteAccessSettings {
  // Until the settings are loaded, other computers are refused
  try {
    return getConfig().remoteAccess ?? { requireKey: true, key: '' };
  } catch {
    return { requireKey: true, key: '' };
  }
}
