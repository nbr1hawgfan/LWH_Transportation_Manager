/* Dispatch Board → Recruiting tab (manager side of the Toolkit's Recruiter).
   Credit a driver when someone they referred applies or is hired; the
   manager passcode is checked by the recruit server. */
(function () {
  'use strict';
  const RECRUIT_URL = 'https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/recruit';
  const PASS_KEY = 'recruitPass';
  const el = id => document.getElementById(id);
  const S = s => LWHUI.safe(s);
  const BADGES = [[250, '🏆 Hall of Fame'], [100, '🥇 Top Recruiter'], [50, '🥈 Talent Scout'], [10, '🥉 Recruiter']];
  const badge = p => (BADGES.find(([n]) => p >= n) || [0, ''])[1];
  const post = async body => {
    const res = await fetch(RECRUIT_URL, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b.error || ('HTTP ' + res.status));
    return b;
  };
  const myName = () => (window.TMApp && TMApp.managerName()) || '';
  let stats = null, period = 'month';

  async function loadStats() { stats = await post({ action: 'stats', code: '' }); }

  function renderBoard(box) {
    if (!stats) return;
    const key = period === 'month' ? 'pointsMonth' : 'points';
    const rows = stats.board.slice().sort((a, b) => b[key] - a[key] || b.scans - a.scans).slice(0, 100);
    box.innerHTML = rows.length ? `<ol class="rc-board">${rows.map((r, i) => `<li>
        <span class="rc-rank">${r[key] > 0 ? i + 1 : '–'}</span>
        <span class="rc-name">${S(r.name)}${badge(r.points) ? ` <small>${badge(r.points)}</small>` : ''}</span>
        <span class="rc-pts"><b>${r[key]}</b> pts<small>${r.applied} applied · ${r.hired} hired · ${r.scans} reached</small></span>
      </li>`).join('')}</ol>` : '<p class="hint">No points yet.</p>';
  }

  function renderDispatch() {
    const box = el('ybResults'); if (!stats) { box.innerHTML = '<p class="hint">Loading…</p>'; return; }
    const opts = stats.board.filter(r => r.codes.length).map(r => `<option value="${S(r.codes[0])}">${S(r.name)}</option>`).join('');
    box.innerHTML = `
      <div class="card rc-credit">
        <h3 style="margin-top:0">Credit a referral</h3>
        <p class="hint">When an applicant was sent by one of our drivers (the application says "Current Employee", or they name who sent them), credit that driver here.</p>
        <div class="grid-2">
          <label>Driver<select id="rcAwDriver">${opts || '<option value="">No drivers have opened Recruiter yet</option>'}</select></label>
          <label>Applicant name<input id="rcAwApplicant" autocomplete="off" placeholder="e.g. John Smith" /></label>
        </div>
        <div class="segmented" id="rcAwKind"><button type="button" class="seg active" data-kind="Applied">Applied · +${stats.points.Applied}</button><button type="button" class="seg" data-kind="Hired">Hired · +${stats.points.Hired}</button></div>
        <div class="grid-2">
          <label>Note (optional)<input id="rcAwNote" autocomplete="off" placeholder="e.g. OTR, starts Monday" /></label>
          <label>Manager passcode<input id="rcAwPass" type="password" autocomplete="off" value="${S(sessionStorage.getItem(PASS_KEY) || '')}" /></label>
        </div>
        <div class="actions"><button type="button" id="rcAwGo">Credit points</button></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="yb-driver-head"><h3 style="margin:0">Leaderboard</h3>
          <div class="segmented rc-period" style="margin:0"><button type="button" class="seg${period === 'month' ? ' active' : ''}" data-period="month">This month</button><button type="button" class="seg${period === 'all' ? ' active' : ''}" data-period="all">All time</button></div></div>
        <div id="rcDispBoard"></div>
      </div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Recent credits</h3>
        ${stats.recent.length ? `<ol class="yb-tl">${stats.recent.map(a => `<li class="yb-tl-item"><span class="yb-tl-time">${new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          <div><span class="yb-chip ${a.kind === 'Hired' ? 's-delivered' : 's-arrived'}">${S(a.kind)} +${a.points}</span> <b>${S(a.driver_name)}</b>${a.applicant ? ' · ' + S(a.applicant) : ''}
          <div class="hint">${a.note ? S(a.note) + ' · ' : ''}${a.awarded_by ? 'by ' + S(a.awarded_by) + ' · ' : ''}<button type="button" class="yb-tnum" data-unaward="${a.id}">Undo</button></div></div></li>`).join('')}</ol>` : '<p class="hint">No credits yet.</p>'}
      </div>`;
    renderBoard(el('rcDispBoard'));
  }

  async function award() {
    const code = el('rcAwDriver').value, kind = document.querySelector('#rcAwKind .seg.active').dataset.kind;
    const pass = el('rcAwPass').value.trim();
    if (!code) { LWHUI.toast('Pick a driver'); return; }
    if (!el('rcAwApplicant').value.trim()) { LWHUI.toast('Enter the applicant\'s name'); return; }
    if (!pass) { LWHUI.toast('Enter the manager passcode'); return; }
    const btn = el('rcAwGo'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await post({ action: 'award', passcode: pass, code, kind, applicant: el('rcAwApplicant').value, note: el('rcAwNote').value, by: myName() });
      sessionStorage.setItem(PASS_KEY, pass);
      LWHUI.toast(`Credited ${kind} to ${el('rcAwDriver').selectedOptions[0].textContent}`);
      await loadStats(); renderDispatch();
    } catch (e) { LWHUI.toast(e.message); btn.disabled = false; btn.textContent = 'Credit points'; }
  }
  async function unaward(id) {
    const pass = (el('rcAwPass') && el('rcAwPass').value.trim()) || sessionStorage.getItem(PASS_KEY) || '';
    if (!pass) { LWHUI.toast('Enter the manager passcode above first'); return; }
    if (!confirm('Remove this credit?')) return;
    try { await post({ action: 'unaward', passcode: pass, id: +id }); await loadStats(); renderDispatch(); LWHUI.toast('Credit removed'); }
    catch (e) { LWHUI.toast(e.message); }
  }

  window.addEventListener('load', () => {
    if (!el('yardBoard')) return;
    el('yardBoard').addEventListener('click', e => {
      if (!window.LWHRecruit.boardOpen) return;
      const k = e.target.closest('#rcAwKind [data-kind]'); if (k) { document.querySelectorAll('#rcAwKind .seg').forEach(x => x.classList.toggle('active', x === k)); return; }
      const p = e.target.closest('.rc-period [data-period]'); if (p) { period = p.dataset.period; renderDispatch(); return; }
      if (e.target.closest('#rcAwGo')) { award(); return; }
      const u = e.target.closest('[data-unaward]'); if (u) unaward(u.dataset.unaward);
    });
  });
  window.LWHRecruit = {
    boardOpen: false,
    async openBoard() {
      this.boardOpen = true; el('ybResults').innerHTML = '<p class="hint">Loading recruiting…</p>';
      try { await loadStats(); } catch (e) { el('ybResults').innerHTML = `<div class="card"><p class="hint" style="margin:0">Couldn't load recruiting (${S(e.message)}).</p></div>`; return; }
      renderDispatch();
    },
    closeBoard() { this.boardOpen = false; }
  };
})();
