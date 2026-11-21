/** The current remote access settings, for the guards (read on every request) */
import { getConfig } from '../utils/config';
import os from 'os';
import { app } from 'electron';
import { appOrigins, type LocalContext, type RemoteAccessSettings } from './accessKey';

export function remoteAccessSettings(): RemoteAccessSettings {
  // Until the settings are loaded, other computers are refused
  try {
    return getConfig().remoteAccess ?? { requireKey: true, key: '' };
  } catch {
    return { requireKey: true, key: '' };
  }
}

let ownCache: { at: number; list: string[] } | null = null;

/** This computer's own network addresses (cached for a few seconds) */
function ownAddresses(): string[] {
  if (ownCache && Date.now() - ownCache.at < 5000) return ownCache.list;
  const list = Object.values(os.networkInterfaces()).flatMap((l) => (l ?? []).map((a) => a.address));
  ownCache = { at: Date.now(), list };
  return list;
}

/** What counts as this computer for the access key (development as the windows define it: they then load from the Vite server) */
export function localContext(): LocalContext {
  const own = ownAddresses();
  let webPort = 5657;
  try {
    webPort = getConfig().general.port || 5657;
  } catch {
    // settings not loaded yet: the default port
  }
  return { own, origins: appOrigins({ webPort, dev: process.env.NODE_ENV === 'development' || !app?.isPackaged, own }) };
}
