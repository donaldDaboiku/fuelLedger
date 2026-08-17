(function(){
  const STORAGE_KEY = 'frrEntries';
  const META_KEY = 'frrReportMeta';
  const OPENING_BALANCE_KEY = 'frrOpeningBalance';
  let entries = [];
  const reportTitle = 'FuelLedger';
  const defaultLogo = 'image/web/icon.svg';
  let editingIndex = null;

  function amountFrom(value){
    const amount = Number.parseFloat(value);
    return Number.isFinite(amount) ? amount : 0;
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
