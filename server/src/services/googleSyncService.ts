import dotenv from 'dotenv';
import { query } from '../config/db';

dotenv.config();

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxIN0yxGmHN2GELHmaiGkfeekOyQt8sJjUNU_gRqOBtgcqZfb98P6J3qQK_pGWlGG0l/exec';

export const syncToGoogleSheetAsync = (action: string, payload: any) => {
  if (!GOOGLE_SCRIPT_URL) return;

  // Run in background (fire-and-forget / non-blocking)
  setImmediate(async () => {
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload })
      });
      
      if (!response.ok) {
        console.warn(`[GoogleSync] Warning: Response status ${response.status} for action ${action}`);
      } else {
        console.log(`[GoogleSync] Successfully synced action ${action} to Google Sheet`);
      }
    } catch (error) {
      console.error(`[GoogleSync] Failed to sync action ${action} to Google Sheet:`, error);
      if (payload && payload.id) {
        try {
          await query('UPDATE orders SET sync_google_status = $1 WHERE id = $2', ['FAILED', payload.id]);
        } catch (dbErr) {
          console.error('[GoogleSync] Failed to mark sync status in DB:', dbErr);
        }
      }
    }
  });
};
