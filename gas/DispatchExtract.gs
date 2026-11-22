/***** Dispatch Extract + Transportation Manager Weekly Plan sync
 *
 * Replace the whole Code.gs in the Dispatch Extract project with this file.
 * The Dispatch_Extract sheet output is exactly the same as before. New: after it is written,
 * syncDispatchToSupabase() sends every weekly tab to Supabase for
 * Transportation Manager > Dispatch Board > Weekly Plan.
 *
 * One-time setup:
 *   1. Project Settings > Script Properties > add DISPATCH_SYNC_KEY (the key Tim was given).
 *   2. Run testDispatchSync() once and approve the permissions (it now calls an outside URL).
 *   3. Run createHybridTriggers() once if you want the faster every-15-minutes refresh.
 *
 * The Weekly Plan feed also picks up what Dispatch_Extract skips:
 *   - Saturday and Sunday (those columns have no NOTES column next to them)
 *   - BULLPEN loads (rows with no driver under the BULLPEN heading)
 *   - drivers with nothing planned yet (so the whole roster shows, in the sheet's order)
 *****/

/***** CONFIG *****/
const CONFIG = {
  SOURCE_SHEET_ID: '1EH2Iiw-oD5U2oPVtP_9wpkKavOZNuddlMp-URUj8Gc4', // dispatcher workbook (weekly tabs)
  DEST_SHEET_ID:   '1vdMDBUdQ2LIDgp1IpsXwC9fE4aLFdXHB6NhzuzZ0rEs',   // tidy table workbook
  OUTPUT_SHEET_NAME: 'Dispatch_Extract',
  // Header row index and where the static left columns live in the weekly tabs:
  HEADER_ROW: 1,
  GROUP_COL: 1,   // "Group/Division" (column A)
  TRUCK_COL: 2,   // "TRUCK" (column B)
  DRIVER_COL: 3,  // "DRIVER" (column C)
  // Day names we’ll recognize in headers:
  DAY_NAMES: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  // Weekly tab name pattern, e.g. "9-22-25"
  TAB_REGEX: /^\d{1,2}-\d{1,2}-\d{2}$/i
};

// Transportation Manager Weekly Plan (Supabase). The key lives in Script Properties, not in code.
const PLAN_SYNC = {
  URL: 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/dispatch_plan_push',
  API_KEY: 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT',
  KEY_PROPERTY: 'DISPATCH_SYNC_KEY',
  WEEKS_BACK: 10      // only send tabs whose week ended within this many weeks (keeps it quick)
};

/***** ENTRYPOINT *****/
function runFullExtract() {
  const src = SpreadsheetApp.openById(CONFIG.SOURCE_SHEET_ID);
  const dst = SpreadsheetApp.openById(CONFIG.DEST_SHEET_ID);
  const out = getOrCreateSheet(dst, CONFIG.OUTPUT_SHEET_NAME);

  // Clear & write header
  out.clear();
  const header = ['TabName','Date','Day','Group','Truck','Driver','Assignment','Notes'];
  out.getRange(1,1,1,header.length).setValues([header]);

  let writeRow = 2;
  const sheets = src.getSheets();

  sheets.forEach(sh => {
    const tabName = sh.getName();
    if (!CONFIG.TAB_REGEX.test(tabName)) return; // skip non-weekly tabs

    const rows = extractWeeklyTab(sh, tabName);
    if (rows.length === 0) return;

    out.getRange(writeRow, 1, rows.length, header.length).setValues(rows);
    writeRow += rows.length;
  });

  SpreadsheetApp.flush();
  Logger.log(`✅ Wrote ${writeRow - 2} rows to ${CONFIG.OUTPUT_SHEET_NAME}`);

  // Weekly Plan in Transportation Manager. A failure here never stops the sheet extract.
  try { syncDispatchToSupabase(src); }
  catch (e) { Logger.log('⚠️ Weekly Plan sync failed: ' + e.message); }
}

/***** CORE: Extract one weekly sheet into tidy rows *****/
function extractWeeklyTab(sh, tabName) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < CONFIG.HEADER_ROW + 1 || lastCol < CONFIG.DRIVER_COL + 1) return [];

  const display = sh.getRange(1,1,lastRow,lastCol).getDisplayValues();
  const headerRow = display[CONFIG.HEADER_ROW - 1];

  // Discover day blocks dynamically (main col for assignments + its NOTES col)
  const dayBlocks = detectDayBlocks(headerRow);
  if (dayBlocks.length === 0) return [];

  const rows = [];
  // Start reading below header; use the max used area under left columns
  for (let r = CONFIG.HEADER_ROW + 1; r <= lastRow; r++) {
    const group = (display[r-1][CONFIG.GROUP_COL-1] || '').toString().trim();
    const truck = (display[r-1][CONFIG.TRUCK_COL-1] || '').toString().trim();
    const driver = (display[r-1][CONFIG.DRIVER_COL-1] || '').toString().trim();

    // Skip totally empty left side rows
    const leftHasData = [group, truck, driver].some(x => x.length > 0);
    if (!leftHasData) continue;

    for (const blk of dayBlocks) {
      const assignment = safeCell(display, r-1, blk.mainCol-1);
      const notes = safeCell(display, r-1, blk.notesCol-1);

      // If both blank, skip
      if (!assignment && !notes) continue;

      const outDate = toISODate(blk.date);
      rows.push([
        tabName,
        outDate,         // Date (YYYY-MM-DD)
        blk.dayName,     // Day
        group,           // Group/Division (col A)
        truck,
        driver,
        assignment,
        notes
      ]);
    }
  }

  return rows;
}

/***** Detect day blocks from the header row *****/
function detectDayBlocks(headerRow) {
  const blocks = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cell = (headerRow[c] || '').toString().trim();
    if (!cell) continue;

    // Look for something like "Monday 9-22-25" or "Monday 09-22-2025"
    const day = CONFIG.DAY_NAMES.find(d => cell.toLowerCase().startsWith(d.toLowerCase()));
    if (!day) continue;

    // Try to pull a date from the remainder of the header cell
    const dateText = cell.replace(new RegExp('^' + day, 'i'), '').trim();
    const parsedDate = parseUsDateLike(dateText);

    // Find a NOTES column within the next 1–3 columns
    // (In your screenshot, day spans 3 cols and the 3rd is "NOTES")
    let notesCol = null;
    for (let lookAhead = 0; lookAhead < 3; lookAhead++) {
      const maybe = (headerRow[c + lookAhead] || '').toString().trim().toLowerCase();
      if (maybe === 'notes') {
        notesCol = c + lookAhead + 1; // 1-based
        break;
      }
    }

    // The main assignment column is the first column of the block (current c)
    const mainCol = c + 1; // 1-based

    if (parsedDate && notesCol) {
      blocks.push({ dayName: day, date: parsedDate, mainCol, notesCol });
      // Advance c so we don’t re-detect inside the same block
      c = notesCol - 1; // because loop will ++
    }
  }
  return blocks;
}

/***** WEEKLY PLAN → SUPABASE *****/
function syncDispatchToSupabase(src) {
  const key = PropertiesService.getScriptProperties().getProperty(PLAN_SYNC.KEY_PROPERTY);
  if (!key) { Logger.log('Weekly Plan sync skipped: add ' + PLAN_SYNC.KEY_PROPERTY + ' in Script Properties.'); return; }
  src = src || SpreadsheetApp.openById(CONFIG.SOURCE_SHEET_ID);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7 * PLAN_SYNC.WEEKS_BACK);

  const tabs = [];
  src.getSheets().forEach(sh => {
    const name = sh.getName();
    if (!CONFIG.TAB_REGEX.test(name)) return;
    const t = planFromTab(sh, name);
    if (t && new Date(t.week_end + 'T12:00:00') >= cutoff) tabs.push(t);
  });
  if (!tabs.length) { Logger.log('Weekly Plan sync: no weekly tabs found.'); return; }

  const res = UrlFetchApp.fetch(PLAN_SYNC.URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: PLAN_SYNC.API_KEY },
    payload: JSON.stringify({ p_key: key, p_tabs: tabs, p_source: 'Dispatch Extract' })
  });
  const body = res.getContentText();
  let j = {}; try { j = JSON.parse(body); } catch (e) {}
  if (res.getResponseCode() !== 200 || !j.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + res.getResponseCode() + ' ' + body.slice(0, 200)));
  Logger.log(`✅ Weekly Plan: sent ${j.tabs} weeks, ${j.cells} cells`);
}

// One weekly tab → {tab, week_start, week_end, rows:[{row_no, section, grp, truck, driver, days:[{date, a, n}]}]}
function planFromTab(sh, tabName) {
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < CONFIG.HEADER_ROW + 1 || lastCol < CONFIG.DRIVER_COL + 1) return null;
  const v = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const days = planDayColumns(v[CONFIG.HEADER_ROW - 1]);
  if (!days.length) return null;
  const isoDays = days.map(d => d.iso).sort();

  const rows = [];
  let section = '';
  for (let r = CONFIG.HEADER_ROW; r < v.length; r++) {
    const row = v[r];
    const a = cellText(row[CONFIG.GROUP_COL - 1]), b = cellText(row[CONFIG.TRUCK_COL - 1]), c = cellText(row[CONFIG.DRIVER_COL - 1]);
    const cells = days.map(d => ({ date: d.iso, a: cellText(row[d.main]), n: d.notes === null ? '' : cellText(row[d.notes]) }))
                      .filter(x => x.a || x.n);
    if (!a && !b && !c && !cells.length) continue;            // blank row
    if (c) section = '';                                       // a real driver row ends a heading's block (e.g. SPOTTER after BULLPEN)
    else if (a && !b && !cells.length && !/^\d+$/.test(a)) { section = a; continue; }   // a heading like BULLPEN
    const truckInA = !b && !c && /^\d+$/.test(a);              // bullpen truck typed in column A
    rows.push({
      row_no: r + 1,
      section: section,
      grp: truckInA ? section : (a || section),
      truck: truckInA ? a : b,
      driver: c,
      days: cells
    });
  }
  return { tab: tabName, week_start: isoDays[0], week_end: isoDays[isoDays.length - 1], rows: rows };
}

// Every day header in the row, with its NOTES column when the next column is NOTES (Sat/Sun have none).
function planDayColumns(headerRow) {
  const out = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cell = cellText(headerRow[c]);
    const day = CONFIG.DAY_NAMES.find(d => cell.toLowerCase().startsWith(d.toLowerCase()));
    if (!day) continue;
    const date = parseUsDateLike(cell.replace(new RegExp('^' + day, 'i'), '').trim());
    if (!date) continue;
    const next = cellText(headerRow[c + 1]).toLowerCase();
    out.push({ day: day, iso: toISODate(date), main: c, notes: next === 'notes' ? c + 1 : null });
  }
  return out;
}

function cellText(x) { return x == null ? '' : String(x).replace(/\s+/g, ' ').trim(); }

// Run once from the editor to approve permissions and check the key.
function testDispatchSync() { syncDispatchToSupabase(); }

/***** Helpers *****/
function getOrCreateSheet(ss, name) {
  const sh = ss.getSheetByName(name);
  return sh || ss.insertSheet(name);
}

function safeCell(values, rIdx, cIdx) {
  const v = values?.[rIdx]?.[cIdx];
  return (v == null) ? '' : v.toString().trim();
}

// Accepts strings like "9-22-25", "09/22/2025", etc.
function parseUsDateLike(s) {
  if (!s) return null;
  const t = s.replace(/\s+/g, '');
  // M-D-YY(YY) or M/D/YY(YY)
  const m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (!m) return null;
  let [_, mm, dd, yy] = m;
  mm = +mm; dd = +dd; yy = +yy;
  if (yy < 100) yy += 2000; // assume 20xx
  // Month is 0-based in JS Date
  const d = new Date(yy, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  // YYYY-MM-DD in spreadsheet’s timezone
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}


/***** TRIGGER SETUP *****/
function createHybridTriggers() {
  // clear existing
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runFullExtract') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // every 15 minutes, so the Weekly Plan in Transportation Manager stays close to the sheet
  ScriptApp.newTrigger('runFullExtract')
    .timeBased()
    .everyMinutes(15)
    .create();
}
