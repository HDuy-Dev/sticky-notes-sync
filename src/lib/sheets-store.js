// Finds or creates the user's "Sticky Notes Sync" spreadsheet and reads and
// writes its rows through the Drive v3 and Sheets v4 REST APIs. With the
// drive.file scope only spreadsheets this app created are visible.

import { SHEET_NAME, APP_PROPERTY } from '../config.js';
import { FOLDER_COLUMNS, NOTE_COLUMNS, TABS, parseTab } from './sheet-rows.js';
import { DriveAccessMissing } from './google-auth.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetMissing extends Error {}

export class ApiError extends Error {
  constructor(status) {
    super(`Google API error ${status}`);
    this.status = status;
  }
}

// A 403 caused by a token without the Drive scope (the user unticked it on
// Google's consent screen, or removed it later).
async function isMissingScope(res) {
  try {
    const { error } = await res.json();
    const reasons = [...(error?.details || []), ...(error?.errors || [])].map(d => d.reason);
    return reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions');
  } catch {
    return false;
  }
}

export function createSheetsStore({ fetchFn, getToken, onUnauthorized }) {
  // A 404 on a spreadsheet means the user deleted it; on Drive it is an error.
  async function request(url, { method = 'GET', body, sheet = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${await getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) {
        await onUnauthorized();
        continue;
      }
      if (sheet && res.status === 404) throw new SheetMissing('Spreadsheet not found');
      if (res.status === 403 && (await isMissingScope(res))) throw new DriveAccessMissing('Drive permission not granted');
      if (res.status >= 400) throw new ApiError(res.status);
      return res.json();
    }
  }

  async function create() {
    const { id } = await request(DRIVE_FILES, {
      method: 'POST',
      body: {
        name: SHEET_NAME,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value },
      },
    });
    await request(`${SHEETS}/${id}:batchUpdate`, {
      method: 'POST',
      sheet: true,
      body: {
        requests: [
          { addSheet: { properties: { title: TABS.folders, gridProperties: { frozenRowCount: 1 } } } },
          { addSheet: { properties: { title: TABS.notes, gridProperties: { frozenRowCount: 1 } } } },
          { deleteSheet: { sheetId: 0 } },
        ],
      },
    });
    await request(`${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      sheet: true,
      body: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TABS.folders}!A1`, values: [FOLDER_COLUMNS] },
          { range: `${TABS.notes}!A1`, values: [NOTE_COLUMNS] },
        ],
      },
    });
    return id;
  }

  async function findOrCreate() {
    const url = new URL(DRIVE_FILES);
    url.searchParams.set('q', `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and trashed=false`);
    url.searchParams.set('orderBy', 'createdTime');
    url.searchParams.set('fields', 'files(id)');
    url.searchParams.set('spaces', 'drive');
    const { files = [] } = await request(url.toString());
    if (files.length) return { spreadsheetId: files[0].id, created: false };
    return { spreadsheetId: await create(), created: true };
  }

  async function readAll(id) {
    const url = new URL(`${SHEETS}/${id}/values:batchGet`);
    url.searchParams.append('ranges', `${TABS.folders}!A:F`);
    url.searchParams.append('ranges', `${TABS.notes}!A:I`);
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    const { valueRanges = [] } = await request(url.toString(), { sheet: true });
    const folders = parseTab(valueRanges[0]?.values, 'folders');
    const notes = parseTab(valueRanges[1]?.values, 'notes');
    return {
      folders: folders.records,
      notes: notes.records,
      rowIndex: { folders: folders.rowById, notes: notes.rowById },
    };
  }

  async function write(id, plan) {
    if (plan.updates.length) {
      await request(`${SHEETS}/${id}/values:batchUpdate`, {
        method: 'POST',
        sheet: true,
        body: { valueInputOption: 'RAW', data: plan.updates },
      });
    }
    for (const [tab, rows] of Object.entries(plan.appends)) {
      if (!rows.length) continue;
      await request(`${SHEETS}/${id}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        sheet: true,
        body: { values: rows },
      });
    }
  }

  const url = id => `https://docs.google.com/spreadsheets/d/${id}/edit`;

  return { findOrCreate, readAll, write, url };
}
