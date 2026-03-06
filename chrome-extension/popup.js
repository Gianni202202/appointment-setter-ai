// ============================================================
// Elvatix Pipeline — Sales Navigator Import v2.1
// ============================================================

const API_URL = 'https://appointmentsetter-ai.vercel.app';

function log(msg) {
  const el = document.getElementById('log');
  if (el) {
    const t = new Date().toLocaleTimeString();
    el.textContent += `[${t}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }
  console.log('[Elvatix]', msg);
}

function showSaved() {
  const badge = document.getElementById('saved-badge');
  if (badge) { badge.classList.add('show'); setTimeout(() => badge.classList.remove('show'), 2000); }
}

document.addEventListener('DOMContentLoaded', async () => {
  log('Extension v2.1 loaded');
  log('API: ' + API_URL);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  log('Tab: ' + url.substring(0, 80));
  
  const isSalesNav = url.includes('linkedin.com/sales/search') || url.includes('linkedin.com/sales/lists');

  if (isSalesNav) {
    document.getElementById('on-sales-nav').style.display = 'block';
    document.getElementById('not-on-sales-nav').style.display = 'none';
    // Clean URL for display (remove query params that cause issues)
    const cleanUrl = url.split('?')[0];
    document.getElementById('search-url').textContent = url.substring(0, 85) + (url.length > 85 ? '...' : '');
    log('✅ Sales Navigator detected');
  } else {
    document.getElementById('on-sales-nav').style.display = 'none';
    document.getElementById('not-on-sales-nav').style.display = 'block';
    log('⚠️ Not on Sales Navigator');
  }

  // Load saved instruction from API
  try {
    const res = await fetch(`${API_URL}/api/prospects/instruction`);
    const data = await res.json();
    if (data.instruction) {
      document.getElementById('instruction').value = data.instruction;
      log('📝 Loaded saved instruction');
    }
  } catch (e) {
    log('Could not load saved instruction: ' + e.message);
  }

  // Update char count
  const instrEl = document.getElementById('instruction');
  const countEl = document.getElementById('instruction-count');
  if (instrEl && countEl) {
    instrEl.addEventListener('input', () => {
      countEl.textContent = instrEl.value.length > 0 ? instrEl.value.length + ' chars' : '';
    });
  }

  // Auto-save instruction on change (debounced)
  let saveTimer = null;
  instrEl?.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await fetch(`${API_URL}/api/prospects/instruction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: instrEl.value }),
        });
        showSaved();
        log('💾 Instruction auto-saved');
      } catch {}
    }, 1500);
  });

  // Test API
  document.getElementById('btn-test')?.addEventListener('click', async () => {
    log('Testing API...');
    try {
      const res = await fetch(`${API_URL}/api/prospects`);
      const data = await res.json();
      log('✅ Connected! ' + JSON.stringify(data.stats || {}));
    } catch (err) {
      log('❌ Test failed: ' + err.message);
    }
  });

  // Open dashboard
  document.getElementById('btn-open-dashboard')?.addEventListener('click', () => {
    chrome.tabs.create({ url: `${API_URL}/prospects` });
  });

  // Import button
  document.getElementById('btn-import')?.addEventListener('click', async () => {
    const maxResults = parseInt(document.getElementById('max-results')?.value || '25');
    const instruction = document.getElementById('instruction')?.value?.trim() || '';
    await startImport(url, maxResults, instruction);
  });
});

async function startImport(searchUrl, maxResults, instruction) {
  const btn = document.getElementById('btn-import');
  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const result = document.getElementById('result');

  btn.disabled = true;
  btn.textContent = '⏳ Importing...';
  progress.classList.add('active');
  result.className = 'result';

  try {
    // Step 1: Import
    progressFill.style.width = '20%';
    progressText.textContent = '🔍 Searching Sales Navigator...';
    log('POST /api/prospects/search');

    // Clean the URL - only pass the base URL path, strip problematic params
    const cleanUrl = searchUrl.split('?')[0];
    const urlParams = new URLSearchParams(searchUrl.split('?')[1] || '');
    // Keep only essential params
    const essentialParams = ['query', 'keywords', 'List'];
    const cleanParams = new URLSearchParams();
    for (const [key, val] of urlParams) {
      if (essentialParams.some(p => key.toLowerCase().includes(p.toLowerCase()))) {
        cleanParams.set(key, val);
      }
    }
    const finalUrl = cleanParams.toString() ? cleanUrl + '?' + cleanParams.toString() : searchUrl;

    const searchRes = await fetch(`${API_URL}/api/prospects/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: searchUrl, maxResults }),
    });

    const searchText = await searchRes.text();
    log('Search: ' + searchRes.status + ' — ' + searchText.substring(0, 200));
    
    let searchData;
    try { searchData = JSON.parse(searchText); } catch { throw new Error('Invalid response: ' + searchText.substring(0, 80)); }
    if (!searchRes.ok) throw new Error(searchData.error || 'HTTP ' + searchRes.status);

    progressFill.style.width = '40%';
    
    const parts = [];
    if (searchData.added > 0) parts.push('📥 ' + searchData.added + ' imported');
    if (searchData.skipped > 0) parts.push('⏭️ ' + searchData.skipped + ' skipped');
    if (searchData.already_connected > 0) parts.push('🤝 ' + searchData.already_connected + ' connected');
    if (searchData.already_invited > 0) parts.push('📨 ' + searchData.already_invited + ' invited');
    if (parts.length === 0) parts.push('No new prospects found');
    
    progressText.textContent = parts.join('  ·  ');
    log('Import: ' + parts.join(', '));

    // Step 2: Auto-enrich if any were added
    if (searchData.added > 0) {
      progressFill.style.width = '50%';
      progressText.textContent = '✨ Enriching ' + searchData.added + ' profiles & generating messages...';
      log('Starting enrichment (12-15s between profiles)...');

      const enrichBody = { maxCount: searchData.added };
      if (instruction) enrichBody.instruction = instruction;

      const enrichRes = await fetch(`${API_URL}/api/prospects/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enrichBody),
      });

      const enrichText = await enrichRes.text();
      log('Enrich: ' + enrichRes.status + ' — ' + enrichText.substring(0, 300));
      
      let enrichData;
      try { enrichData = JSON.parse(enrichText); } catch { enrichData = { error: enrichText.substring(0, 80) }; }

      progressFill.style.width = '90%';

      if (enrichData.success && enrichData.processed > 0) {
        parts.push('✨ ' + enrichData.processed + ' messages generated');
        log('✅ Enriched ' + enrichData.processed + '/' + enrichData.total);
      } else if (enrichData.error) {
        parts.push('⚠️ Enrichment: ' + enrichData.error);
        log('⚠️ Enrich issue: ' + enrichData.error);
      }
    }

    progressFill.style.width = '100%';
    progressText.textContent = '✅ Complete!';

    result.className = 'result active success';
    result.innerHTML = '<strong>🎉 Pipeline Complete</strong><br>' + parts.join('<br>') + 
      (searchData.added > 0 ? '<br><br>📊 Review messages in the <strong>Dashboard</strong>' : '');
    
    btn.textContent = '✅ Done!';
    setTimeout(() => { btn.textContent = '🚀 Import & Generate Messages'; btn.disabled = false; }, 4000);

  } catch (error) {
    log('❌ ERROR: ' + error.message);
    
    progressFill.style.width = '100%';
    progressFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    progressText.textContent = 'Failed';

    result.className = 'result active error';
    result.textContent = '❌ ' + error.message;

    btn.textContent = '🔄 Retry';
    btn.disabled = false;
  }
}
