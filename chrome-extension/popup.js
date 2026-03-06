// ============================================================
// Elvatix — Sales Navigator Importer v2.0 (with instruction)
// ============================================================

const API_URL = 'https://appointmentsetter-ai.vercel.app';

function log(msg) {
  const logEl = document.getElementById('log');
  if (logEl) {
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log('[Elvatix]', msg);
}

document.addEventListener('DOMContentLoaded', async () => {
  log('Extension v2.0 loaded');
  log('API: ' + API_URL);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  log('Tab: ' + url.substring(0, 80) + '...');
  
  const isSalesNav = url.includes('linkedin.com/sales/search') || url.includes('linkedin.com/sales/lists');

  if (isSalesNav) {
    document.getElementById('on-sales-nav').style.display = 'flex';
    document.getElementById('on-sales-nav').style.flexDirection = 'column';
    document.getElementById('on-sales-nav').style.gap = '0';
    document.getElementById('not-on-sales-nav').style.display = 'none';
    document.getElementById('search-url').textContent = url.substring(0, 80) + (url.length > 80 ? '...' : '');
    document.getElementById('search-info').textContent = 'Ready to import search results';
    log('✅ Sales Navigator detected');
  } else {
    document.getElementById('on-sales-nav').style.display = 'none';
    document.getElementById('not-on-sales-nav').style.display = 'block';
    log('⚠️ Not on Sales Navigator');
  }

  // Test connection
  document.getElementById('btn-test')?.addEventListener('click', async () => {
    log('Testing API...');
    try {
      const res = await fetch(`${API_URL}/api/prospects`, { method: 'GET' });
      const data = await res.json();
      log('✅ Connected! Status: ' + res.status);
      log('DB: ' + JSON.stringify(data.stats || {}));
    } catch (err) {
      log('❌ Test failed: ' + err.message);
    }
  });

  // Import button
  document.getElementById('btn-import')?.addEventListener('click', async () => {
    const maxResults = parseInt(document.getElementById('max-results').value);
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
  progressFill.style.background = 'linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)';
  result.className = 'result';
  result.style.display = 'none';

  try {
    // Step 1: Import prospects
    progressFill.style.width = '15%';
    progressText.textContent = 'Searching Sales Navigator...';
    log('POST ' + API_URL + '/api/prospects/search');
    log('Body: url=' + searchUrl.substring(0, 60) + '..., max=' + maxResults);

    const searchRes = await fetch(`${API_URL}/api/prospects/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: searchUrl, maxResults }),
    });

    log('Search response: ' + searchRes.status);
    const searchText = await searchRes.text();
    log('Search body: ' + searchText.substring(0, 200));
    
    let searchData;
    try { searchData = JSON.parse(searchText); } catch { throw new Error('Invalid response: ' + searchText.substring(0, 100)); }

    if (!searchRes.ok) throw new Error(searchData.error || 'Search failed: HTTP ' + searchRes.status);

    progressFill.style.width = '40%';
    
    const importSummary = [];
    importSummary.push(`📥 ${searchData.added} imported`);
    if (searchData.skipped > 0) importSummary.push(`⏭️ ${searchData.skipped} skipped`);
    if (searchData.already_connected > 0) importSummary.push(`🤝 ${searchData.already_connected} connected`);
    if (searchData.already_invited > 0) importSummary.push(`📨 ${searchData.already_invited} invited`);
    
    progressText.textContent = importSummary.join(' · ');
    log('✅ Import: ' + importSummary.join(', '));

    // Step 2: Auto-enrich (if any were added)
    if (searchData.added > 0) {
      progressFill.style.width = '50%';
      progressText.textContent = `✨ Enriching ${searchData.added} profiles & generating messages (8-20s each)...`;
      log('Starting enrichment with instruction: ' + (instruction || '(default)'));

      const enrichBody = { maxCount: searchData.added };
      if (instruction) enrichBody.instruction = instruction;

      const enrichRes = await fetch(`${API_URL}/api/prospects/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enrichBody),
      });

      const enrichText = await enrichRes.text();
      log('Enrich response: ' + enrichRes.status);
      log('Enrich body: ' + enrichText.substring(0, 300));
      
      let enrichData;
      try { enrichData = JSON.parse(enrichText); } catch { enrichData = { error: enrichText.substring(0, 100) }; }

      progressFill.style.width = '90%';

      if (enrichData.success) {
        progressText.textContent = `✅ ${enrichData.processed}/${enrichData.total} enriched & messages ready!`;
        log('✅ Enriched: ' + enrichData.processed + '/' + enrichData.total);
        
        // Show generated messages
        if (enrichData.results) {
          const msgs = enrichData.results.filter(r => r.success).map(r => `• ${r.name}: "${r.message?.substring(0, 50)}..."`);
          log('Messages:\n' + msgs.join('\n'));
        }
      } else {
        progressText.textContent = `⚠️ Imported but enrichment had issues: ${enrichData.error || 'unknown'}`;
        log('⚠️ Enrich issues: ' + (enrichData.error || JSON.stringify(enrichData)));
      }
    }

    progressFill.style.width = '100%';

    result.className = 'result success';
    result.innerHTML = `
      <strong>🎉 Pipeline Complete!</strong><br>
      ${importSummary.join(' · ')}<br>
      ${searchData.added > 0 ? '✨ Messages generated — review in dashboard' : ''}
      ${searchData.has_more ? '<br>📄 More results available (' + searchData.total_found + ' total)' : ''}
    `;
    result.style.display = 'block';
    
    btn.textContent = '✅ Done!';
    setTimeout(() => {
      btn.textContent = '🚀 Import & Generate Messages';
      btn.disabled = false;
    }, 4000);

  } catch (error) {
    log('❌ ERROR: ' + error.message);
    log('Type: ' + error.constructor.name);
    
    progressFill.style.width = '100%';
    progressFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    progressText.textContent = 'Failed';

    result.className = 'result error';
    result.textContent = '❌ ' + error.message;
    result.style.display = 'block';

    btn.textContent = '🔄 Retry';
    btn.disabled = false;
  }
}
