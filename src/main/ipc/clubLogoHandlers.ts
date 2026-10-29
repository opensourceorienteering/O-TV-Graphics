/**
 * IPC for club logos: status (bundled sets, hand-added logos) and opening the manual folder.
 * Logos are not downloaded by users; they ship with the app (scripts/fetch-club-logos.js).
 */

import { ipcMain, shell } from 'electron';
import { getClubLogoService } from '../data/ClubLogoService';

export function registerClubLogoHandlers(): void {
  ipcMain.handle('clubLogos:status', async () => {
    const service = getClubLogoService();
    if (!service) return { success: false, error: 'Club logos are not available yet' };
    return { success: true, data: service.status() };
  });

  ipcMain.handle('clubLogos:openFolder', async () => {
    const service = getClubLogoService();
    if (!service) return { success: false, error: 'Club logos are not available yet' };
    const error = await shell.openPath(service.getManualDir());
    return error ? { success: false, error } : { success: true };
  });
}
