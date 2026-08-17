(function(){
  const MONTHLY_STORAGE_KEY = 'frrMonthlyLedgers';
  const SELECTED_MONTH_KEY = 'frrSelectedMonth';
  const LEGACY_ENTRIES_KEY = 'frrEntries';
  const LEGACY_META_KEY = 'frrReportMeta';
  const LEGACY_OPENING_BALANCE_KEY = 'frrOpeningBalance';
  let entries = [];
  let monthlyLedgers = {};
  const reportTitle = 'FuelLedger';
  const defaultLogo = 'image/web/icon.svg';
  let editingIndex = null;
  let dashboardView = 'month';
  let activeMonth = new Date().toISOString().slice(0, 7);

  function amountFrom(value){
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value ?? '')
      .replace(/[₦$£€,\s]/g, '')
      .replace(/^\((.*)\)$/, '-$1')
      .trim();
    if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
    const amount = Number.parseFloat(cleaned);
    return Number.isFinite(amount) ? amount : 0;
  }

  function toIsoDate(value){
    const raw = String(value ?? '').trim();
    if (!raw || raw === '—' || raw === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const slash = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (slash) {
      let day = Number(slash[1]);
      let month = Number(slash[2]);
      let year = Number(slash[3]);
      if (year < 100) year += 2000;
      if (day > 31 && month <= 12) [day, month] = [month, day];
      if (month > 12 && day <= 12) [day, month] = [month, day];
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    const named = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
    if (named) {
      const d = new Date(`${named[1]} ${named[2]} ${named[3]}`);
      if (!Number.isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return '';
  }

  function normalizeEntry(entry){
    return {
      date: typeof entry?.date === 'string' ? entry.date : '',
      receipt: String(entry?.receipt || ''),
      desc: String(entry?.desc || ''),
      vehicle: String(entry?.vehicle || ''),
      requested: String(entry?.requested || ''),
      from: String(entry?.from || ''),
      to: String(entry?.to || ''),
      received: Math.max(0, amountFrom(entry?.received)),
      disbursed: Math.max(0, amountFrom(entry?.disbursed)),
      createdAt: Number.isFinite(entry?.createdAt) ? entry.createdAt : Date.now()
    };
  }

  const form = document.getElementById('entryForm');
  const entryList = document.getElementById('entryList');
  const emptyState = document.getElementById('emptyState');
  const summary = document.getElementById('summary');
  const entryBadge = document.getElementById('entryBadge');
  const previewBal = document.getElementById('previewBal');
  const genStamp = document.getElementById('genStamp');
  const reportMonthInput = document.getElementById('reportMonth');
  const openingBalanceInput = document.getElementById('openingBalance');
  const formTitle = document.getElementById('formTitle');
  const saveEntryBtn = document.getElementById('saveEntryBtn');
  const statusMessage = document.getElementById('statusMessage');
  const printPreviewModal = document.getElementById('printPreviewModal');
  const printPreviewContent = document.getElementById('printPreviewContent');
  const printReport = document.getElementById('printReport');
  let printTrigger = null;

  function currentMonth(){
    return activeMonth || reportMonthInput.value || new Date().toISOString().slice(0, 7);
  }

  function monthLabelText(month){
    const date = new Date(`${month}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return month;
    return date.toLocaleDateString('en-NG', { month:'long', year:'numeric' });
  }

  function shiftMonth(month, delta){
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(year, mon - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function emptyLedger(){
    return { entries: [], preparedBy: '', reportDate: '', openingBalance: 0 };
  }

  function monthFromDate(isoDate, fallback = currentMonth()){
    const month = String(isoDate || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) ? month : fallback;
  }

  function sortEntries(){
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  }

  function saveMonth(month){
    if (!month) return;
    sortEntries();
    monthlyLedgers[month] = {
      entries: entries.map(normalizeEntry),
      preparedBy: document.getElementById('preparedBy').value,
      reportDate: document.getElementById('reportDate').value,
      openingBalance: openingBalance()
    };
    localStorage.setItem(MONTHLY_STORAGE_KEY, JSON.stringify(monthlyLedgers));
  }

  function saveCurrentMonth(){
    saveMonth(activeMonth);
  }

  function saveEntries(){ saveCurrentMonth(); }

  function saveMeta(){
    saveCurrentMonth();
  }

  function formHasUnsavedDraft(){
    if (editingIndex !== null) return true;
    const fields = ['f-receipt', 'f-desc', 'f-vehicle', 'f-requested', 'f-from', 'f-to'];
    if (fields.some(id => document.getElementById(id).value.trim())) return true;
    if (amountFrom(document.getElementById('f-received').value) > 0 || amountFrom(document.getElementById('f-disbursed').value) > 0) return true;
    const dateValue = document.getElementById('f-date').value;
    return Boolean(dateValue && dateValue !== `${activeMonth}-01` && dateValue.slice(0, 7) !== activeMonth);
  }

  function loadMonth(month){
    const ledger = monthlyLedgers[month] || emptyLedger();
    entries = Array.isArray(ledger.entries) ? ledger.entries.map(normalizeEntry) : [];
    document.getElementById('preparedBy').value = ledger.preparedBy || '';
    document.getElementById('reportDate').value = ledger.reportDate || `${month}-01`;
    openingBalanceInput.value = String(Math.max(0, amountFrom(ledger.openingBalance)));
    editingIndex = null;
    form.reset();
    document.getElementById('f-date').value = `${month}-01`;
    formTitle.textContent = 'Add a transaction';
    saveEntryBtn.textContent = '+ Add to report';
    renderMonthNav();
    renderList();
  }

  function renderMonthNav(){
    const month = currentMonth();
    const label = document.getElementById('monthLabel');
    const hint = document.getElementById('monthRecordHint');
    const chips = document.getElementById('monthChips');
    if (label) label.textContent = monthLabelText(month);
    const count = entries.length;
    if (hint) hint.textContent = count
      ? `${count} record${count === 1 ? '' : 's'} this month`
      : 'No records this month yet';
    const savedMonths = Object.keys(monthlyLedgers)
      .filter(key => Array.isArray(monthlyLedgers[key]?.entries) && monthlyLedgers[key].entries.length)
      .sort()
      .reverse();
    if (chips) {
      chips.innerHTML = savedMonths.map(key =>
        `<button type="button" class="month-chip${key === month ? ' active' : ''}" data-month="${key}">${monthLabelText(key)}</button>`
      ).join('');
    }
  }

  function switchToMonth(month){
    if (!month) return;
    if (month === activeMonth) {
      reportMonthInput.value = activeMonth;
      return;
    }
    if (formHasUnsavedDraft() && !window.confirm('You have unsaved form changes or an unfinished edit. Switch month and discard them?')) {
      reportMonthInput.value = activeMonth;
      return;
    }
    saveMonth(activeMonth);
    activeMonth = month;
    reportMonthInput.value = month;
    localStorage.setItem(SELECTED_MONTH_KEY, month);
    loadMonth(month);
    showStatus(`Showing ${monthLabelText(month)}.`);
  }

  function redistributeLedgersByEntryDate(source){
    const next = {};
    Object.entries(source || {}).forEach(([bucketMonth, ledger]) => {
      if (!ledger || typeof ledger !== 'object') return;
      const list = Array.isArray(ledger.entries) ? ledger.entries : [];
      if (!next[bucketMonth]) {
        next[bucketMonth] = {
          ...emptyLedger(),
          preparedBy: ledger.preparedBy || '',
          reportDate: ledger.reportDate || '',
          openingBalance: amountFrom(ledger.openingBalance)
        };
      } else {
        if (!next[bucketMonth].preparedBy && ledger.preparedBy) next[bucketMonth].preparedBy = ledger.preparedBy;
        if (!next[bucketMonth].reportDate && ledger.reportDate) next[bucketMonth].reportDate = ledger.reportDate;
        if (!next[bucketMonth].openingBalance && amountFrom(ledger.openingBalance)) {
          next[bucketMonth].openingBalance = amountFrom(ledger.openingBalance);
        }
      }
      list.forEach(raw => {
        const entry = normalizeEntry(raw);
        const targetMonth = monthFromDate(entry.date, bucketMonth);
        if (!next[targetMonth]) next[targetMonth] = emptyLedger();
        next[targetMonth].entries.push(entry);
      });
    });
    Object.values(next).forEach(ledger => {
      ledger.entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    });
    return next;
  }

  function migrateLegacyEntries(){
    const legacyEntries = JSON.parse(localStorage.getItem(LEGACY_ENTRIES_KEY) || '[]');
    if (!Array.isArray(legacyEntries) || !legacyEntries.length) return false;
    const legacyMeta = JSON.parse(localStorage.getItem(LEGACY_META_KEY) || '{}');
    const fallbackMonth = monthFromDate(legacyMeta.reportDate, activeMonth);
    legacyEntries.map(normalizeEntry).forEach(entry => {
      const targetMonth = monthFromDate(entry.date, fallbackMonth);
      if (!monthlyLedgers[targetMonth]) monthlyLedgers[targetMonth] = emptyLedger();
      monthlyLedgers[targetMonth].entries.push(entry);
    });
    if (!monthlyLedgers[fallbackMonth]) monthlyLedgers[fallbackMonth] = emptyLedger();
    monthlyLedgers[fallbackMonth].preparedBy = legacyMeta.preparedBy || monthlyLedgers[fallbackMonth].preparedBy || '';
    monthlyLedgers[fallbackMonth].reportDate = legacyMeta.reportDate || monthlyLedgers[fallbackMonth].reportDate || `${fallbackMonth}-01`;
    monthlyLedgers[fallbackMonth].openingBalance = amountFrom(localStorage.getItem(LEGACY_OPENING_BALANCE_KEY));
    Object.values(monthlyLedgers).forEach(ledger => {
      ledger.entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    });
    return true;
  }

  function initialiseMonthlyLedgers(){
    const todayMonth = new Date().toISOString().slice(0, 7);
    activeMonth = localStorage.getItem(SELECTED_MONTH_KEY) || todayMonth;
    reportMonthInput.value = activeMonth;
    try {
      const saved = JSON.parse(localStorage.getItem(MONTHLY_STORAGE_KEY) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) monthlyLedgers = saved;
    } catch (_) {}

    let changed = false;
    if (!Object.keys(monthlyLedgers).length) {
      try {
        changed = migrateLegacyEntries() || changed;
      } catch (_) {}
    }

    const repaired = redistributeLedgersByEntryDate(monthlyLedgers);
    if (JSON.stringify(repaired) !== JSON.stringify(monthlyLedgers)) {
      monthlyLedgers = repaired;
      changed = true;
    }
    if (changed) localStorage.setItem(MONTHLY_STORAGE_KEY, JSON.stringify(monthlyLedgers));
    if (!monthlyLedgers[activeMonth] && Object.keys(monthlyLedgers).length) {
      const newest = Object.keys(monthlyLedgers).sort().reverse()[0];
      activeMonth = newest;
      reportMonthInput.value = newest;
      localStorage.setItem(SELECTED_MONTH_KEY, newest);
    }
    loadMonth(activeMonth);
  }

  document.getElementById('preparedBy').addEventListener('input', saveMeta);
  document.getElementById('reportDate').addEventListener('change', saveMeta);
  openingBalanceInput.addEventListener('input', () => {
    const value = Math.max(0, amountFrom(openingBalanceInput.value));
    openingBalanceInput.value = String(value);
    saveCurrentMonth();
    renderList();
  });
  reportMonthInput.addEventListener('change', () => {
    if (!reportMonthInput.value) {
      reportMonthInput.value = activeMonth;
      return;
    }
    switchToMonth(reportMonthInput.value);
  });
  document.getElementById('prevMonthBtn').addEventListener('click', () => switchToMonth(shiftMonth(activeMonth, -1)));
  document.getElementById('nextMonthBtn').addEventListener('click', () => switchToMonth(shiftMonth(activeMonth, 1)));
  document.getElementById('monthChips').addEventListener('click', event => {
    const chip = event.target.closest('[data-month]');
    if (chip) switchToMonth(chip.dataset.month);
  });
  document.querySelectorAll('.dash-toggle').forEach(button => {
    button.addEventListener('click', () => {
      dashboardView = button.dataset.dashView === 'week' ? 'week' : 'month';
      renderDashboard();
    });
  });

  function openingBalance(){
    return Math.max(0, amountFrom(openingBalanceInput.value));
  }

  function showStatus(message, isError = false){
    statusMessage.textContent = message;
    statusMessage.classList.toggle('error', isError);
  }

  genStamp.textContent = 'Generated ' + new Date().toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });

  const fReceived = document.getElementById('f-received');
  const fDisbursed = document.getElementById('f-disbursed');

  const nairaFmt = (n) => {
    const isNeg = n < 0;
    const abs = Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return (isNeg ? '-' : '') + '₦' + abs;
  };

  function currentBalance(exceptIndex = null){
    return entries.reduce((bal, e, index) => index === exceptIndex ? bal : bal + e.received - e.disbursed, openingBalance());
  }

  function updatePreview(){
    const received = parseFloat(fReceived.value) || 0;
    const disbursed = parseFloat(fDisbursed.value) || 0;
    const projected = currentBalance(editingIndex) + received - disbursed;
    previewBal.textContent = nairaFmt(projected);
    previewBal.classList.toggle('negative', projected < 0);
  }
  fReceived.addEventListener('input', updatePreview);
  fDisbursed.addEventListener('input', updatePreview);

  function escapeHtml(s){
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function formatDate(iso){
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function weekOfMonth(isoDate){
    const day = Number(String(isoDate || '').slice(8, 10));
    if (!day) return 1;
    return Math.min(5, Math.ceil(day / 7));
  }

  function entriesForMonth(month){
    const ledger = monthlyLedgers[month];
    if (ledger && Array.isArray(ledger.entries)) return ledger.entries.map(normalizeEntry);
    return month === currentMonth() ? entries.slice() : [];
  }

  function summarizeEntries(list){
    return list.reduce((acc, entry) => {
      acc.received += entry.received;
      acc.disbursed += entry.disbursed;
      acc.count += 1;
      return acc;
    }, { received: 0, disbursed: 0, count: 0 });
  }

  function polarToCartesian(cx, cy, radius, angleInDegrees){
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
    return {
      x: cx + (radius * Math.cos(angleInRadians)),
      y: cy + (radius * Math.sin(angleInRadians))
    };
  }

  function describeArc(cx, cy, radius, startAngle, endAngle){
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} L ${cx} ${cy} Z`;
  }

  function renderPieChart(target, slices){
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    if (!total) {
      target.innerHTML = '<div class="chart-empty">No amounts to chart yet</div>';
      return;
    }
    let angle = 0;
    const paths = slices.filter(slice => slice.value > 0).map(slice => {
      const sweep = (slice.value / total) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      if (sweep >= 359.99) {
        return `<circle cx="110" cy="110" r="78" fill="${slice.color}"></circle>`;
      }
      return `<path d="${describeArc(110, 110, 78, start, end)}" fill="${slice.color}"></path>`;
    }).join('');
    target.innerHTML = `<svg viewBox="0 0 220 220" role="img" aria-label="Pie chart">${paths}<circle cx="110" cy="110" r="42" fill="#fff"></circle></svg>`;
  }

  function renderBarChart(target, bars){
    const maxValue = Math.max(...bars.map(bar => Math.max(bar.received || 0, bar.disbursed || 0)), 0);
    if (!maxValue) {
      target.innerHTML = '<div class="chart-empty">No weekly activity yet</div>';
      return;
    }
    const width = 340;
    const height = 210;
    const padL = 36;
    const padB = 34;
    const padT = 16;
    const chartW = width - padL - 12;
    const chartH = height - padB - padT;
    const groupWidth = chartW / bars.length;
    const barWidth = Math.max(8, groupWidth * 0.28);
    const grid = [0.25, 0.5, 0.75, 1].map(part => {
      const y = padT + chartH - (chartH * part);
      return `<line x1="${padL}" y1="${y}" x2="${width - 12}" y2="${y}" stroke="#e6eef1" stroke-width="1"></line>`;
    }).join('');
    const groups = bars.map((bar, index) => {
      const x0 = padL + index * groupWidth + groupWidth * 0.18;
      const receivedH = (bar.received / maxValue) * chartH;
      const disbursedH = (bar.disbursed / maxValue) * chartH;
      const labelX = padL + index * groupWidth + groupWidth / 2;
      return `
        <g>
          <rect x="${x0}" y="${padT + chartH - receivedH}" width="${barWidth}" height="${receivedH}" fill="#1c7a4d" rx="2"></rect>
          <rect x="${x0 + barWidth + 4}" y="${padT + chartH - disbursedH}" width="${barWidth}" height="${disbursedH}" fill="#a3372c" rx="2"></rect>
          <text x="${labelX}" y="${height - 12}" text-anchor="middle" font-size="11" fill="#5b6b7a">${escapeHtml(bar.label)}</text>
        </g>`;
    }).join('');
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">
      ${grid}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#dbe2e8"></line>
      <line x1="${padL}" y1="${padT + chartH}" x2="${width - 12}" y2="${padT + chartH}" stroke="#dbe2e8"></line>
      ${groups}
    </svg>`;
  }

  const VEHICLE_COLORS = ['#0f5b78', '#1c7a4d', '#a3372c', '#c47a1d', '#5b4b8a', '#2a7f8f', '#8a4b2a', '#4a6fa5', '#6b7c3b', '#7a3f6d'];

  function vehicleBreakdown(list){
    const map = new Map();
    list.forEach(entry => {
      const key = (entry.vehicle || '').trim() || 'Unassigned';
      const current = map.get(key) || { vehicle: key, received: 0, disbursed: 0, count: 0 };
      current.received += entry.received;
      current.disbursed += entry.disbursed;
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.disbursed - a.disbursed || b.received - a.received || a.vehicle.localeCompare(b.vehicle));
  }

  function renderVehicleBarChart(target, rows){
    if (!rows.length) {
      target.innerHTML = '<div class="chart-empty">No vehicle amounts yet</div>';
      return;
    }
    const maxValue = Math.max(...rows.map(row => row.disbursed), 0);
    if (!maxValue) {
      target.innerHTML = '<div class="chart-empty">No vehicle disbursements yet</div>';
      return;
    }
    const rowHeight = 28;
    const padL = 108;
    const padR = 64;
    const padT = 8;
    const width = 520;
    const height = padT + rows.length * rowHeight + 8;
    const chartW = width - padL - padR;
    const bars = rows.map((row, index) => {
      const y = padT + index * rowHeight;
      const barW = Math.max(2, (row.disbursed / maxValue) * chartW);
      const label = row.vehicle.length > 14 ? `${row.vehicle.slice(0, 13)}…` : row.vehicle;
      return `
        <g>
          <text x="${padL - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="#5b6b7a">${escapeHtml(label)}</text>
          <rect x="${padL}" y="${y + 4}" width="${barW}" height="16" fill="${row.color}" rx="3"></rect>
          <text x="${padL + barW + 6}" y="${y + 15}" font-size="10" fill="#1c2b3a">${escapeHtml(nairaFmt(row.disbursed))}</text>
        </g>`;
    }).join('');
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vehicle disbursement bar chart">${bars}</svg>`;
  }

  function renderVehicleBreakdown(list, title){
    const vehicleTitle = document.getElementById('vehicleChartTitle');
    const vehiclePie = document.getElementById('vehiclePieChart');
    const vehicleBar = document.getElementById('vehicleBarChart');
    const vehicleLegend = document.getElementById('vehicleLegend');
    if (!vehiclePie || !vehicleBar || !vehicleLegend) return;
    if (vehicleTitle) vehicleTitle.textContent = title;

    const rows = vehicleBreakdown(list).map((row, index) => ({
      ...row,
      color: VEHICLE_COLORS[index % VEHICLE_COLORS.length]
    }));
    const pieSlices = rows
      .filter(row => row.disbursed > 0)
      .map(row => ({ label: row.vehicle, value: row.disbursed, color: row.color }));

    if (!pieSlices.length) {
      vehiclePie.innerHTML = '<div class="chart-empty">No vehicle disbursements yet</div>';
      vehicleBar.innerHTML = '<div class="chart-empty">Add vehicle numbers on transactions to see this breakdown</div>';
      vehicleLegend.innerHTML = '';
      return;
    }

    renderPieChart(vehiclePie, pieSlices);
    renderVehicleBarChart(vehicleBar, rows.filter(row => row.disbursed > 0));
    vehicleLegend.innerHTML = rows.filter(row => row.disbursed > 0).map(row =>
      `<span><i class="swatch" style="background:${row.color}"></i>${escapeHtml(row.vehicle)} ${nairaFmt(row.disbursed)} (${row.count})</span>`
    ).join('');
  }

  function allSavedEntries(){
    const map = new Map();
    Object.keys(monthlyLedgers).forEach(month => {
      const list = Array.isArray(monthlyLedgers[month]?.entries) ? monthlyLedgers[month].entries : [];
      list.forEach(entry => map.set(`${entry.date}|${entry.createdAt}|${entry.desc}|${entry.receipt}`, normalizeEntry(entry)));
    });
    entries.forEach(entry => map.set(`${entry.date}|${entry.createdAt}|${entry.desc}|${entry.receipt}`, normalizeEntry(entry)));
    return Array.from(map.values());
  }

  function renderDashboard(){
    const month = currentMonth();
    const monthEntries = entriesForMonth(month);
    const scope = document.getElementById('dashboardScope');
    const pieTitle = document.getElementById('pieChartTitle');
    const barTitle = document.getElementById('barChartTitle');
    const pieChart = document.getElementById('pieChart');
    const barChart = document.getElementById('barChart');
    const pieLegend = document.getElementById('pieLegend');
    if (!pieChart || !barChart) return;

    document.querySelectorAll('.dash-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.dashView === dashboardView);
    });

    if (dashboardView === 'week') {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      const weekEntries = allSavedEntries().filter(entry => entry.date >= startIso && entry.date <= endIso);
      const totals = summarizeEntries(weekEntries);
      const dayBars = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const dayTotals = summarizeEntries(weekEntries.filter(entry => entry.date === iso));
        return {
          label: day.toLocaleDateString('en-GB', { weekday: 'short' }),
          received: dayTotals.received,
          disbursed: dayTotals.disbursed
        };
      });
      if (scope) scope.textContent = `This week (${formatDate(startIso)} – ${formatDate(endIso)})`;
      if (pieTitle) pieTitle.textContent = 'This week: received vs disbursed';
      if (barTitle) barTitle.textContent = 'Daily activity this week';
      document.getElementById('dashReceived').textContent = nairaFmt(totals.received);
      document.getElementById('dashDisbursed').textContent = nairaFmt(totals.disbursed);
      const net = totals.received - totals.disbursed;
      const netEl = document.getElementById('dashNet');
      netEl.textContent = nairaFmt(net);
      netEl.classList.toggle('negative', net < 0);
      document.getElementById('dashCount').textContent = String(totals.count);
      renderPieChart(pieChart, [
        { label: 'Received', value: totals.received, color: '#1c7a4d' },
        { label: 'Disbursed', value: totals.disbursed, color: '#a3372c' }
      ]);
      pieLegend.innerHTML = `
        <span><i class="swatch" style="background:#1c7a4d"></i>Received ${nairaFmt(totals.received)}</span>
        <span><i class="swatch" style="background:#a3372c"></i>Disbursed ${nairaFmt(totals.disbursed)}</span>`;
      renderBarChart(barChart, dayBars);
      renderVehicleBreakdown(weekEntries, 'This week: disbursement by vehicle');
      return;
    }

    const totals = summarizeEntries(monthEntries);
    const weekBars = [1, 2, 3, 4, 5].map(week => {
      const weekTotals = summarizeEntries(monthEntries.filter(entry => weekOfMonth(entry.date) === week));
      return { label: `W${week}`, received: weekTotals.received, disbursed: weekTotals.disbursed };
    });
    if (scope) scope.textContent = `Monthly overview for ${monthLabelText(month)}`;
    if (pieTitle) pieTitle.textContent = 'This month: received vs disbursed';
    if (barTitle) barTitle.textContent = 'Weekly received & disbursed';
    document.getElementById('dashReceived').textContent = nairaFmt(totals.received);
    document.getElementById('dashDisbursed').textContent = nairaFmt(totals.disbursed);
    const net = totals.received - totals.disbursed;
    const netEl = document.getElementById('dashNet');
    netEl.textContent = nairaFmt(net);
    netEl.classList.toggle('negative', net < 0);
    document.getElementById('dashCount').textContent = String(totals.count);
    renderPieChart(pieChart, [
      { label: 'Received', value: totals.received, color: '#1c7a4d' },
      { label: 'Disbursed', value: totals.disbursed, color: '#a3372c' }
    ]);
    pieLegend.innerHTML = `
      <span><i class="swatch" style="background:#1c7a4d"></i>Received ${nairaFmt(totals.received)}</span>
      <span><i class="swatch" style="background:#a3372c"></i>Disbursed ${nairaFmt(totals.disbursed)}</span>
      <span><i class="swatch" style="background:#1c7a4d"></i>Bar: received</span>
      <span><i class="swatch" style="background:#a3372c"></i>Bar: disbursed</span>`;
    renderBarChart(barChart, weekBars);
    renderVehicleBreakdown(monthEntries, `Disbursement by vehicle · ${monthLabelText(month)}`);
  }

  function renderList(){
    entryList.innerHTML = '';
    if (entries.length === 0){
      emptyState.style.display = 'block';
      summary.style.display = 'none';
      entryBadge.textContent = 'Entry #1';
      renderMonthNav();
      renderDashboard();
      updatePreview();
      return;
    }
    emptyState.style.display = 'none';
    summary.style.display = 'grid';

    let running = openingBalance(), totalR = 0, totalD = 0;
    entries.forEach((e, i) => {
      running += e.received - e.disbursed;
      totalR += e.received;
      totalD += e.disbursed;

      const row = document.createElement('div');
      row.className = 'entry';
      const subBits = [];
      if (e.vehicle) subBits.push(`<span>${escapeHtml(e.vehicle)}</span>`);
      if (e.requested) subBits.push(`<span class="dot">${escapeHtml(e.requested)}</span>`);
      if (e.from) subBits.push(`<span class="dot">from ${escapeHtml(e.from)}</span>`);
      if (e.to) subBits.push(`<span class="dot">to ${escapeHtml(e.to)}</span>`);
      if (e.receipt) subBits.push(`<span class="dot">#${escapeHtml(e.receipt)}</span>`);
      row.innerHTML = `
        <div class="idx">${i + 1}</div>
        <div class="details">
          <div class="top">
            <span class="desc">${escapeHtml(e.desc || 'Untitled entry')}</span>
            <span class="date">${formatDate(e.date)}</span>
          </div>
          <div class="sub">${subBits.join('')}</div>
        </div>
        <div class="amounts">
          ${e.received ? `<span class="flow in">+${nairaFmt(e.received)}</span>` : ''}
          ${e.disbursed ? `<span class="flow out">-${nairaFmt(e.disbursed)}</span>` : ''}
          <span class="bal ${running < 0 ? 'negative' : ''}">${nairaFmt(running)}</span>
        </div>
        <div class="row-btns">
          <button class="ghost" type="button" data-action="edit" data-idx="${i}">Edit</button>
          <button class="ghost" type="button" data-action="delete" data-idx="${i}">Delete</button>
        </div>
      `;
      entryList.appendChild(row);
    });

    document.getElementById('sumReceived').textContent = nairaFmt(totalR);
    document.getElementById('sumDisbursed').textContent = nairaFmt(totalD);
    const balEl = document.getElementById('sumBalance');
    balEl.textContent = nairaFmt(running);
    entryBadge.textContent = editingIndex === null ? `Entry #${entries.length + 1}` : `Editing entry #${editingIndex + 1}`;
    renderMonthNav();
    renderDashboard();
    updatePreview();
  }

  entryList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!Number.isInteger(idx) || !entries[idx]) return;
    if (btn.dataset.action === 'edit') {
      const entry = entries[idx];
      editingIndex = idx;
      document.getElementById('f-date').value = entry.date;
      document.getElementById('f-receipt').value = entry.receipt;
      document.getElementById('f-desc').value = entry.desc;
      document.getElementById('f-vehicle').value = entry.vehicle;
      document.getElementById('f-requested').value = entry.requested;
      document.getElementById('f-from').value = entry.from;
      document.getElementById('f-to').value = entry.to;
      fReceived.value = entry.received || '';
      fDisbursed.value = entry.disbursed || '';
      formTitle.textContent = 'Edit transaction';
      saveEntryBtn.textContent = 'Save changes';
      renderList();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('f-date').focus();
      return;
    }
    if (!window.confirm('Delete this transaction? This cannot be undone unless you restore a backup.')) return;
    entries.splice(idx, 1);
    if (editingIndex === idx) resetForm();
    else if (editingIndex !== null && idx < editingIndex) editingIndex--;
    saveEntries();
    renderList();
    showStatus('Transaction deleted.');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('f-date').value;
    if (!date){
      document.getElementById('f-date').focus();
      return;
    }
    const received = amountFrom(fReceived.value);
    const disbursed = amountFrom(fDisbursed.value);
    if (received < 0 || disbursed < 0 || (received === 0 && disbursed === 0)) {
      showStatus('Enter an amount received or disbursed greater than zero.', true);
      return;
    }
    const entry = normalizeEntry({
      date,
      receipt: document.getElementById('f-receipt').value.trim(),
      desc: document.getElementById('f-desc').value.trim(),
      vehicle: document.getElementById('f-vehicle').value.trim(),
      requested: document.getElementById('f-requested').value.trim(),
      from: document.getElementById('f-from').value.trim(),
      to: document.getElementById('f-to').value.trim(),
      received,
      disbursed,
      createdAt: editingIndex === null ? Date.now() : entries[editingIndex].createdAt
    });
    const wasEditing = editingIndex !== null;
    if (wasEditing) entries[editingIndex] = entry;
    else entries.push(entry);
    saveEntries();
    renderList();
    resetForm(date);
    showStatus(wasEditing ? 'Transaction updated.' : 'Transaction added.');
  });

  function resetForm(date = ''){
    editingIndex = null;
    form.reset();
    formTitle.textContent = 'Add a transaction';
    saveEntryBtn.textContent = '+ Add to report';
    if (date) document.getElementById('f-date').value = date;
    else document.getElementById('f-date').value = `${currentMonth()}-01`;
    renderList();
    updatePreview();
    document.getElementById('f-date').focus();
  }

  document.getElementById('clearFormBtn').addEventListener('click', () => {
    resetForm();
    showStatus('Form cleared.');
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const headers = ['Trans. Date','Receipt/Invoice No.','Description','Vehicle No.','Requested By','Received From','Paid To','Amount Received (N)','Amt Disbursed (N)','Running Balance (N)'];
    const lines = [headers.join(',')];
    let running = openingBalance();
    entries.forEach(e => {
      running += e.received - e.disbursed;
      const vals = [e.date, e.receipt, e.desc, e.vehicle, e.requested, e.from, e.to, e.received.toFixed(2), e.disbursed.toFixed(2), running.toFixed(2)]
        .map(v => `"${(v || '').toString().replace(/"/g,'""')}"`);
      lines.push(vals.join(','));
    });
    downloadFile(lines.join('\n'), 'text/csv;charset=utf-8;', 'fuelledger.csv');
  });

  function reportRows(){
    let running = openingBalance();
    return entries.map((entry, index) => {
      running += entry.received - entry.disbursed;
      return { ...entry, index: index + 1, running };
    });
  }

  function buildReportMarkup(){
    const rows = reportRows();
    const totalReceived = entries.reduce((total, entry) => total + entry.received, 0);
    const totalDisbursed = entries.reduce((total, entry) => total + entry.disbursed, 0);
    const closingBalance = openingBalance() + totalReceived - totalDisbursed;
    const preparedBy = document.getElementById('preparedBy').value.trim() || '—';
    const reportDate = document.getElementById('reportDate').value;
    const body = rows.map(row => `
      <tr>
        <td>${row.index}</td>
        <td>${escapeHtml(formatDate(row.date))}</td>
        <td>${escapeHtml(row.receipt || '—')}</td>
        <td>${escapeHtml(row.desc || '—')}</td>
        <td>${escapeHtml(row.vehicle || '—')}</td>
        <td>${escapeHtml(row.requested || '—')}</td>
        <td>${escapeHtml(row.from || '—')}</td>
        <td>${escapeHtml(row.to || '—')}</td>
        <td class="number">${nairaFmt(row.received)}</td>
        <td class="number">${nairaFmt(row.disbursed)}</td>
        <td class="number">${nairaFmt(row.running)}</td>
      </tr>`).join('');

    return `
      <article class="report-document">
        <header class="report-heading">
          <div class="report-brand">
            <img src="${defaultLogo}" alt="">
            <div><h1>${reportTitle}</h1><p>${escapeHtml(monthLabelText(currentMonth()))} fuel disbursement &amp; running balance report</p></div>
          </div>
          <dl class="report-meta">
            <dt>Report month</dt><dd>${escapeHtml(monthLabelText(currentMonth()))}</dd>
            <dt>Prepared by</dt><dd>${escapeHtml(preparedBy)}</dd>
            <dt>Report date</dt><dd>${escapeHtml(formatDate(reportDate) || '—')}</dd>
            <dt>Opening balance</dt><dd>${nairaFmt(openingBalance())}</dd>
          </dl>
        </header>
        <table class="report-table">
          <thead><tr>
            <th>No.</th><th>Date</th><th>Receipt / Invoice</th><th>Description</th>
            <th>Vehicle</th><th>Requested by</th><th>Received from</th><th>Paid to</th>
            <th>Received</th><th>Disbursed</th><th>Balance</th>
          </tr></thead>
          <tbody>${body || '<tr><td class="empty-report" colspan="11">No transactions recorded.</td></tr>'}</tbody>
        </table>
        <section class="report-totals">
          <div class="report-total"><span>Total received</span><strong>${nairaFmt(totalReceived)}</strong></div>
          <div class="report-total"><span>Total disbursed</span><strong>${nairaFmt(totalDisbursed)}</strong></div>
          <div class="report-total"><span>Closing balance</span><strong>${nairaFmt(closingBalance)}</strong></div>
        </section>
        <footer class="report-footer">Generated ${escapeHtml(new Date().toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' }))}</footer>
      </article>`;
  }

  document.getElementById('exportExcelBtn').addEventListener('click', () => {
    const preparedBy = document.getElementById('preparedBy').value.trim();
    const reportDate = document.getElementById('reportDate').value;
    const headers = ['Trans. Date','Receipt/Invoice No.','Description','Vehicle No.','Requested By','Received From','Paid To','Amount Received (₦)','Amount Disbursed (₦)','Running Balance (₦)'];
    const xmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
    }[character]));
    const textCell = value => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
    const numberCell = value => `<Cell ss:StyleID="Money"><Data ss:Type="Number">${value}</Data></Cell>`;
    const rows = reportRows().map(row => `<Row>
      ${textCell(row.date)}${textCell(row.receipt)}${textCell(row.desc)}${textCell(row.vehicle)}
      ${textCell(row.requested)}${textCell(row.from)}${textCell(row.to)}
      ${numberCell(row.received)}${numberCell(row.disbursed)}${numberCell(row.running)}
    </Row>`).join('');
    const spreadsheet = `<?xml version="1.0"?>
      <?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Styles>
          <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F5B78" ss:Pattern="Solid"/></Style>
          <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#0A3F52"/></Style>
          <Style ss:ID="Label"><Font ss:Bold="1"/><Interior ss:Color="#E6EEF1" ss:Pattern="Solid"/></Style>
          <Style ss:ID="Money"><NumberFormat ss:Format="&quot;₦&quot;#,##0.00"/></Style>
        </Styles>
        <Worksheet ss:Name="FuelLedger Report"><Table>
          <Row><Cell ss:MergeAcross="9" ss:StyleID="Title"><Data ss:Type="String">${xmlEscape(reportTitle)}</Data></Cell></Row>
          <Row><Cell ss:StyleID="Label"><Data ss:Type="String">Prepared by</Data></Cell><Cell ss:MergeAcross="8"><Data ss:Type="String">${xmlEscape(preparedBy)}</Data></Cell></Row>
          <Row><Cell ss:StyleID="Label"><Data ss:Type="String">Report date</Data></Cell><Cell ss:MergeAcross="8"><Data ss:Type="String">${xmlEscape(reportDate)}</Data></Cell></Row>
          <Row><Cell ss:StyleID="Label"><Data ss:Type="String">Opening balance</Data></Cell>${numberCell(openingBalance())}</Row>
          <Row>${headers.map(header => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`).join('')}</Row>
          ${rows || `<Row><Cell ss:MergeAcross="9"><Data ss:Type="String">No transactions recorded.</Data></Cell></Row>`}
        </Table></Worksheet>
      </Workbook>`;
    downloadFile('\uFEFF' + spreadsheet, 'application/vnd.ms-excel;charset=utf-8;', 'fuelledger-report.xls');
    showStatus('Excel report exported.');
  });

  function downloadFile(contents, type, filename){
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('exportBackupBtn').addEventListener('click', () => {
    saveCurrentMonth();
    downloadFile(JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      selectedMonth: activeMonth,
      monthlyLedgers,
      // Keep single-month fields for older restore tools.
      entries,
      meta: {
        preparedBy: document.getElementById('preparedBy').value,
        reportDate: document.getElementById('reportDate').value
      },
      openingBalance: openingBalance()
    }, null, 2), 'application/json;charset=utf-8;', 'fuelledger-backup.json');
    showStatus('Full multi-month backup exported. Keep it somewhere safe.');
  });

  document.getElementById('importBackupBtn').addEventListener('click', () => document.getElementById('importBackupInput').click());
  document.getElementById('importBackupInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const hasMonthly = backup.monthlyLedgers && typeof backup.monthlyLedgers === 'object' && !Array.isArray(backup.monthlyLedgers);
      if (!hasMonthly && !Array.isArray(backup.entries)) throw new Error('Invalid backup');
      if (!window.confirm('Importing replaces all saved monthly ledgers on this device. Continue?')) return;

      if (hasMonthly) {
        monthlyLedgers = redistributeLedgersByEntryDate(backup.monthlyLedgers);
        activeMonth = backup.selectedMonth && monthlyLedgers[backup.selectedMonth]
          ? backup.selectedMonth
          : (Object.keys(monthlyLedgers).sort().reverse()[0] || activeMonth);
      } else {
        const meta = backup.meta && typeof backup.meta === 'object' ? backup.meta : {};
        const fallbackMonth = monthFromDate(meta.reportDate, activeMonth);
        monthlyLedgers = {};
        backup.entries.map(normalizeEntry).forEach(entry => {
          const targetMonth = monthFromDate(entry.date, fallbackMonth);
          if (!monthlyLedgers[targetMonth]) monthlyLedgers[targetMonth] = emptyLedger();
          monthlyLedgers[targetMonth].entries.push(entry);
        });
        if (!monthlyLedgers[fallbackMonth]) monthlyLedgers[fallbackMonth] = emptyLedger();
        monthlyLedgers[fallbackMonth].preparedBy = String(meta.preparedBy || '');
        monthlyLedgers[fallbackMonth].reportDate = String(meta.reportDate || `${fallbackMonth}-01`);
        monthlyLedgers[fallbackMonth].openingBalance = Math.max(0, amountFrom(backup.openingBalance));
        activeMonth = fallbackMonth;
      }

      localStorage.setItem(MONTHLY_STORAGE_KEY, JSON.stringify(monthlyLedgers));
      localStorage.setItem(SELECTED_MONTH_KEY, activeMonth);
      reportMonthInput.value = activeMonth;
      loadMonth(activeMonth);
      showStatus('Backup imported successfully.');
    } catch (_) {
      showStatus('That file is not a valid FuelLedger backup.', true);
    } finally {
      event.target.value = '';
    }
  });

  function normalizeHeader(value){
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function mapColumns(headers){
    const indexes = {};
    headers.forEach((header, index) => {
      const key = normalizeHeader(header);
      if (!key) return;
      if (indexes.date == null && /(^| )(trans )?date($| )/.test(` ${key} `)) indexes.date = index;
      else if (indexes.receipt == null && /receipt|invoice/.test(key)) indexes.receipt = index;
      else if (indexes.desc == null && /description|particular|narration/.test(key)) indexes.desc = index;
      else if (indexes.vehicle == null && /vehicle/.test(key)) indexes.vehicle = index;
      else if (indexes.requested == null && /requested/.test(key)) indexes.requested = index;
      else if (indexes.from == null && /received from|from/.test(key) && !/amount received/.test(key)) indexes.from = index;
      else if (indexes.to == null && /paid to|payee/.test(key)) indexes.to = index;
      else if (indexes.received == null && /amount received|amt received|^received$/.test(key)) indexes.received = index;
      else if (indexes.disbursed == null && /disbursed|amount paid|amt paid/.test(key)) indexes.disbursed = index;
      else if (indexes.opening == null && /opening balance/.test(key)) indexes.opening = index;
    });
    return indexes;
  }

  function cellAt(row, index){
    return index == null ? '' : (row[index] ?? '');
  }

  function entriesFromMatrix(matrix){
    if (!matrix.length) return { imported: [], opening: null };
    let headerIndex = -1;
    let columns = {};
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const mapped = mapColumns(matrix[i]);
      if (mapped.date != null && (mapped.received != null || mapped.disbursed != null || mapped.desc != null)) {
        headerIndex = i;
        columns = mapped;
        break;
      }
    }
    if (headerIndex < 0) throw new Error('Could not find a transaction header row');

    let opening = null;
    for (let i = 0; i < headerIndex; i++) {
      const row = matrix[i].map(normalizeHeader);
      const label = row.join(' ');
      if (/opening balance/.test(label)) {
        const value = matrix[i].find((cell, idx) => idx > 0 && String(cell).trim() !== '');
        if (value != null) opening = amountFrom(value);
      }
    }

    const imported = [];
    for (let i = headerIndex + 1; i < matrix.length; i++) {
      const row = matrix[i];
      if (!row || !row.some(cell => String(cell ?? '').trim())) continue;
      const joined = row.map(cell => String(cell ?? '').trim().toLowerCase()).join(' ');
      if (/^no transactions|^total |^closing balance|^prepared by|^report date|^opening balance/.test(joined)) continue;
      const entry = normalizeEntry({
        date: toIsoDate(cellAt(row, columns.date)),
        receipt: cellAt(row, columns.receipt),
        desc: cellAt(row, columns.desc),
        vehicle: cellAt(row, columns.vehicle),
        requested: cellAt(row, columns.requested),
        from: cellAt(row, columns.from),
        to: cellAt(row, columns.to),
        received: amountFrom(cellAt(row, columns.received)),
        disbursed: amountFrom(cellAt(row, columns.disbursed)),
        createdAt: Date.now() + i
      });
      if (!entry.date && entry.received === 0 && entry.disbursed === 0 && !entry.desc) continue;
      if (!entry.date && entry.received === 0 && entry.disbursed === 0) continue;
      if (entry.received === 0 && entry.disbursed === 0) continue;
      if (!entry.date) entry.date = new Date().toISOString().slice(0, 10);
      imported.push(entry);
    }
    return { imported, opening };
  }

  function parseCsv(text){
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const input = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      const next = input[i + 1];
      if (inQuotes) {
        if (char === '"' && next === '"') { cell += '"'; i++; }
        else if (char === '"') inQuotes = false;
        else cell += char;
        continue;
      }
      if (char === '"') inQuotes = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (char !== '\r') cell += char;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function parseHtmlTable(text){
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const table = doc.querySelector('table');
    if (!table) throw new Error('No table found');
    return Array.from(table.rows).map(tr => Array.from(tr.cells).map(td => td.textContent.trim()));
  }

  function parseSpreadsheetMl(text){
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid spreadsheet XML');
    const rows = [];
    Array.from(doc.getElementsByTagNameNS('*', 'Row')).forEach(rowEl => {
      const cells = [];
      let nextIndex = 1;
      Array.from(rowEl.children).forEach(cellEl => {
        if (!/cell$/i.test(cellEl.localName || '')) return;
        const indexAttr = cellEl.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', 'Index')
          || cellEl.getAttribute('ss:Index')
          || cellEl.getAttribute('Index');
        const index = indexAttr ? Number(indexAttr) : nextIndex;
        while (cells.length < index - 1) cells.push('');
        const data = Array.from(cellEl.getElementsByTagNameNS('*', 'Data'))[0];
        cells.push(data ? data.textContent.trim() : cellEl.textContent.trim());
        nextIndex = index + 1;
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) throw new Error('No spreadsheet rows found');
    return rows;
  }

  function readU16(view, offset){ return view.getUint16(offset, true); }
  function readU32(view, offset){ return view.getUint32(offset, true); }

  async function inflateRaw(bytes){
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack .xlsx files');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzipXlsx(buffer){
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = Math.max(0, bytes.length - 22 - 65536); i <= bytes.length - 22; i++) {
      if (readU32(view, i) === 0x06054b50) eocd = i;
    }
    if (eocd < 0) throw new Error('Invalid Excel zip archive');
    const count = readU16(view, eocd + 10);
    let offset = readU32(view, eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (readU32(view, offset) !== 0x02014b50) throw new Error('Corrupt Excel archive');
      const method = readU16(view, offset + 10);
      const compSize = readU32(view, offset + 20);
      const nameLen = readU16(view, offset + 28);
      const extraLen = readU16(view, offset + 30);
      const commentLen = readU16(view, offset + 32);
      const localOffset = readU32(view, offset + 42);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      const localNameLen = readU16(view, localOffset + 26);
      const localExtraLen = readU16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = bytes.subarray(dataStart, dataStart + compSize);
      let raw;
      if (method === 0) raw = compressed;
      else if (method === 8) raw = await inflateRaw(compressed);
      else throw new Error('Unsupported Excel compression');
      files[name] = new TextDecoder('utf-8').decode(raw);
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function columnIndexFromRef(ref){
    const match = String(ref || '').match(/^([A-Z]+)/i);
    if (!match) return 0;
    let index = 0;
    for (const char of match[1].toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
    return index - 1;
  }

  function firstSheetPath(files){
    const workbook = files['xl/workbook.xml'];
    const rels = files['xl/_rels/workbook.xml.rels'];
    if (!workbook || !rels) return 'xl/worksheets/sheet1.xml';
    const workbookDoc = new DOMParser().parseFromString(workbook, 'application/xml');
    const firstSheet = Array.from(workbookDoc.getElementsByTagNameNS('*', 'sheet'))[0];
    const relId = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    if (!relId) return 'xl/worksheets/sheet1.xml';
    const relsDoc = new DOMParser().parseFromString(rels, 'application/xml');
    const relationship = Array.from(relsDoc.getElementsByTagNameNS('*', 'Relationship')).find(node => node.getAttribute('Id') === relId);
    const target = relationship?.getAttribute('Target') || 'worksheets/sheet1.xml';
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }

  async function parseXlsx(buffer){
    const files = await unzipXlsx(buffer);
    const shared = [];
    if (files['xl/sharedStrings.xml']) {
      const sharedDoc = new DOMParser().parseFromString(files['xl/sharedStrings.xml'], 'application/xml');
      Array.from(sharedDoc.getElementsByTagNameNS('*', 'si')).forEach(si => {
        shared.push(Array.from(si.getElementsByTagNameNS('*', 't')).map(node => node.textContent || '').join(''));
      });
    }
    const sheetPath = firstSheetPath(files);
    const sheetXml = files[sheetPath] || files['xl/worksheets/sheet1.xml'];
    if (!sheetXml) throw new Error('Worksheet not found in Excel file');
    const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const rows = [];
    Array.from(sheetDoc.getElementsByTagNameNS('*', 'row')).forEach(rowEl => {
      const row = [];
      Array.from(rowEl.children).forEach(cellEl => {
        if ((cellEl.localName || '').toLowerCase() !== 'c') return;
        const col = columnIndexFromRef(cellEl.getAttribute('r') || '');
        while (row.length < col) row.push('');
        const type = cellEl.getAttribute('t');
        let value = '';
        if (type === 's') {
          const index = Number(Array.from(cellEl.getElementsByTagNameNS('*', 'v'))[0]?.textContent || 0);
          value = shared[index] || '';
        } else if (type === 'inlineStr') {
          value = Array.from(cellEl.getElementsByTagNameNS('*', 't')).map(node => node.textContent || '').join('');
        } else if (type === 'b') {
          value = Array.from(cellEl.getElementsByTagNameNS('*', 'v'))[0]?.textContent === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = Array.from(cellEl.getElementsByTagNameNS('*', 'v'))[0]?.textContent || '';
        }
        row[col] = value;
      });
      rows.push(row);
    });
    if (!rows.length) throw new Error('No rows found in Excel file');
    return rows;
  }

  async function matrixFromExcelFile(file){
    const name = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip || name.endsWith('.xlsx')) return parseXlsx(buffer);
    const text = new TextDecoder('utf-8').decode(bytes);
    if (/<Workbook[\s>]|ss:Workbook|spreadsheetml/i.test(text)) return parseSpreadsheetMl(text);
    if (/<table[\s>]/i.test(text)) return parseHtmlTable(text);
    if (name.endsWith('.csv') || /[,;\t]/.test(text.split(/\r?\n/, 1)[0] || '')) return parseCsv(text);
    throw new Error('Unsupported spreadsheet format');
  }

  function applyImportedEntries(imported, opening){
    if (!imported.length) throw new Error('No transactions found in that file');
    if (entries.length) {
      if (!window.confirm(`Found ${imported.length} transaction${imported.length === 1 ? '' : 's'}. Add them to your current records?\n\nTip: use Clear all first if you want only the imported records.`)) return;
      entries = entries.concat(imported);
    } else {
      entries = imported;
    }
    if (opening != null && Number.isFinite(opening)) {
      openingBalanceInput.value = String(Math.max(0, opening));
    }
    saveEntries();
    resetForm();
    showStatus(`${imported.length} transaction${imported.length === 1 ? '' : 's'} imported from Excel.`);
  }

  document.getElementById('importExcelBtn').addEventListener('click', () => document.getElementById('importExcelInput').click());
  document.getElementById('importExcelInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    showStatus('Reading Excel file…');
    try {
      const matrix = await matrixFromExcelFile(file);
      const { imported, opening } = entriesFromMatrix(matrix);
      applyImportedEntries(imported, opening);
    } catch (_) {
      showStatus('Could not read that spreadsheet. Try a .xlsx, .xls, CSV, or FuelLedger Excel export.', true);
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!entries.length || !window.confirm(`Clear every transaction in ${monthLabelText(activeMonth)}?\n\nOther months stay unchanged. Export a backup first if you may need these records later.`)) return;
    entries = [];
    saveEntries();
    resetForm();
    showStatus(`Cleared all transactions for ${monthLabelText(activeMonth)}.`);
  });

  function populatePrintPreview(){
    const markup = buildReportMarkup();
    printPreviewContent.innerHTML = markup;
    printReport.innerHTML = markup;
  }

  function closePrintPreview(){
    if (printPreviewModal.open) printPreviewModal.close();
  }

  document.getElementById('printBtn').addEventListener('click', event => {
    printTrigger = event.currentTarget;
    populatePrintPreview();
    printPreviewModal.showModal();
  });
  document.getElementById('confirmPrintBtn').addEventListener('click', () => {
    populatePrintPreview();
    window.print();
  });
  document.getElementById('closePrintPreviewBtn').addEventListener('click', closePrintPreview);
  printPreviewModal.addEventListener('click', event => {
    if (event.target === printPreviewModal) closePrintPreview();
  });
  printPreviewModal.addEventListener('close', () => {
    printPreviewContent.replaceChildren();
    printTrigger?.focus();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  initialiseMonthlyLedgers();
})();
