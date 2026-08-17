(function(){
  const STORAGE_KEY = 'frrEntries';
  const META_KEY = 'frrReportMeta';
  const OPENING_BALANCE_KEY = 'frrOpeningBalance';
  let entries = [];
  const reportTitle = 'FuelLedger';
  const defaultLogo = 'image/web/icon.svg';
  let editingIndex = null;

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

  try {
    const savedEntries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(savedEntries)) entries = savedEntries.map(normalizeEntry);
  } catch (_) {
    entries = [];
  }

  const form = document.getElementById('entryForm');
  const entryList = document.getElementById('entryList');
  const emptyState = document.getElementById('emptyState');
  const summary = document.getElementById('summary');
  const entryBadge = document.getElementById('entryBadge');
  const previewBal = document.getElementById('previewBal');
  const genStamp = document.getElementById('genStamp');
  const openingBalanceInput = document.getElementById('openingBalance');
  const formTitle = document.getElementById('formTitle');
  const saveEntryBtn = document.getElementById('saveEntryBtn');
  const statusMessage = document.getElementById('statusMessage');
  const printPreviewModal = document.getElementById('printPreviewModal');
  const printPreviewContent = document.getElementById('printPreviewContent');
  const printReport = document.getElementById('printReport');
  let printTrigger = null;

  function sortEntries(){
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  }

  function saveEntries(){
    sortEntries();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function saveMeta(){
    localStorage.setItem(META_KEY, JSON.stringify({
      preparedBy: document.getElementById('preparedBy').value,
      reportDate: document.getElementById('reportDate').value
    }));
  }

  try {
    const savedMeta = JSON.parse(localStorage.getItem(META_KEY) || '{}');
    if (savedMeta.preparedBy) document.getElementById('preparedBy').value = savedMeta.preparedBy;
    if (savedMeta.reportDate) document.getElementById('reportDate').value = savedMeta.reportDate;
  } catch (_) {}
  document.getElementById('preparedBy').addEventListener('input', saveMeta);
  document.getElementById('reportDate').addEventListener('change', saveMeta);
  openingBalanceInput.value = localStorage.getItem(OPENING_BALANCE_KEY) || '0';
  openingBalanceInput.addEventListener('input', () => {
    const value = amountFrom(openingBalanceInput.value);
    if (value >= 0) localStorage.setItem(OPENING_BALANCE_KEY, String(value));
    renderList();
  });

  function openingBalance(){
    return Math.max(0, amountFrom(openingBalanceInput.value));
  }

  function showStatus(message, isError = false){
    statusMessage.textContent = message;
    statusMessage.classList.toggle('error', isError);
  }

  genStamp.textContent = 'Generated ' + new Date().toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });
  if (!document.getElementById('reportDate').value) {
    document.getElementById('reportDate').valueAsDate = new Date();
    saveMeta();
  }

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

  function renderList(){
    entryList.innerHTML = '';
    if (entries.length === 0){
      emptyState.style.display = 'block';
      summary.style.display = 'none';
      entryBadge.textContent = 'Entry #1';
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
    else document.getElementById('f-date').valueAsDate = new Date();
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
            <div><h1>${reportTitle}</h1><p>Vehicle fuel disbursement &amp; running balance report</p></div>
          </div>
          <dl class="report-meta">
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
    downloadFile(JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
      meta: JSON.parse(localStorage.getItem(META_KEY) || '{}'),
      openingBalance: openingBalance()
    }, null, 2), 'application/json;charset=utf-8;', 'fuelledger-backup.json');
    showStatus('Backup exported. Keep it somewhere safe.');
  });

  document.getElementById('importBackupBtn').addEventListener('click', () => document.getElementById('importBackupInput').click());
  document.getElementById('importBackupInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!Array.isArray(backup.entries)) throw new Error('Invalid backup');
      if (!window.confirm('Importing replaces all current entries and report details. Continue?')) return;
      entries = backup.entries.map(normalizeEntry);
      const meta = backup.meta && typeof backup.meta === 'object' ? backup.meta : {};
      document.getElementById('preparedBy').value = String(meta.preparedBy || '');
      document.getElementById('reportDate').value = String(meta.reportDate || '');
      openingBalanceInput.value = String(Math.max(0, amountFrom(backup.openingBalance)));
      localStorage.setItem(OPENING_BALANCE_KEY, openingBalanceInput.value);
      saveMeta();
      saveEntries();
      resetForm();
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
      localStorage.setItem(OPENING_BALANCE_KEY, openingBalanceInput.value);
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
    if (!entries.length || !window.confirm('Clear every transaction? Export a backup first if you may need these records later.')) return;
    entries = [];
    saveEntries();
    resetForm();
    showStatus('All transactions cleared.');
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

  renderList();
})();
