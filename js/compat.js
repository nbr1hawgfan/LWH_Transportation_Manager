/* Shared helpers so the Dispatch Board, All Timesheets and Fuel Price Board
   files from the Driver Toolkit run here unchanged. */
(function () {
  'use strict';
  const P = 'lwhmgr_';
  window.LWHStorage = {
    get(k, d = null) { try { const v = JSON.parse(localStorage.getItem(P + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} },
    remove(k) { try { localStorage.removeItem(P + k); } catch (e) {} }
  };
  window.LWHUI = {
    safe(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); },
    toast(msg) { window.TS ? TS.toast(msg) : alert(msg); },
    show(view) { if (window.TMApp) TMApp.open(view); }
  };

  // EIA key (public price data) for the Fuel Price Board
  window.LWHEIA = { key: '1eajXBsHGIRcVHVY9AphqzboTHRS7FOdW5MOloaF' };

  // Days-on-yard math, the same as the Toolkit's Yard Check
  const API = 'https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/';
  const DAY = 86400000;
  const locKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tKey = s => String(s || '').trim().toUpperCase();
  function since(trailer, checks, asOf) {
    const k = tKey(trailer); let first = null;
    for (const c of checks) {
      if (asOf && c.t > asOf) continue;
      if (c.trailers.has(k)) first = c.t; else break;
    }
    return first;
  }
  function normChecks(list, excludeId) {
    const seen = new Set(), out = [];
    list.forEach(c => {
      if (!c || c.id === excludeId || seen.has(c.id)) return; seen.add(c.id);
      const t = new Date(c.checked_at || c.when).getTime(); if (isNaN(t)) return;
      const rows = c.trailers || c.rows || [];
      out.push({ id: c.id, t, trailers: new Set(rows.map(r => tKey(r.trailer)).filter(Boolean)) });
    });
    return out.sort((a, b) => b.t - a.t);
  }
  const calDays = (from, to) => { const a = new Date(from), b = new Date(to); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0); return Math.round((b - a) / DAY); };
  function daysLabel(first, asOf) {
    const d = calDays(first, asOf);
    const when = new Date(first).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return { days: d, text: d >= 1 ? `On yard since ${when} · ${d} day${d === 1 ? '' : 's'}` : `Also here on the last check (${when})` };
  }
  window.LWHYard = { HISTORY_URL: API + 'yard-check-history', locKey, tKey, normChecks, since, daysLabel, calDays };
})();
