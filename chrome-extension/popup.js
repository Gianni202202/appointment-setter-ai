// ============================================
// Elvatix — Sales Navigator Importer (popup)
// ============================================

const API_BASE = ''; // Will be set from storage

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved API URL
  const stored = await chrome.storage.local.get(['apiUrl']);
  const apiUrl = stored.apiUrl || '';

  // Check if we're on Sales Navigator
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const isSalesNav = url.includes('linkedin.com/sales/search') || url.includes('linkedin.com/sales/lists');

  if (isSalesNav) {
    document.getElementById('on-sales-nav').style.display = 'block';
    document.getElementById('not-on-sales-nav').style.display = 'none';
    document.getElementById('search-url').textContent = url.substring(0, 100) + (url.length > 100 ? '...' : '');
    document.getElementById('search-info').textContent = 'Ready to import search results';
  } else {
    document.getElementById('on-sales-nav').style.display = 'none';
    document.getElementById('not-on-sales-nav').style.display = 'block';
  }

  // Import button
  document.getElementById('btn-import')?.addEventListener('click', async () => {
    const maxResults = parseInt(document.getElementById('max-results').value);
    await startImport(url, maxResults, apiUrl);
  });
});

async function startImport(searchUrl, maxResults, apiUrl) {
  const btn = document.getElementById('btn-import');
  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const result = document.getElementById('result');

  btn.disabled = true;
  btn.textContent = '⏳ Importing...';
  progress.classList.add('active');
  result.className = 'result';
  result.style.display = 'none';

  try {
    progressFill.style.width = '20%';
    progressText.textContent = 'Sending search to Elvatix...';

    // Get API URL from storage or use default
    const stored = await chrome.storage.local.get(['apiUrl']);
    const baseUrl = stored.apiUrl || window.location.origin;

    const response = await fetch(`${baseUrl}/api/prospects/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: searchUrl,
        maxResults: maxResults,
      }),
    });

    progressFill.style.width = '80%';
    progressText.textContent = 'Processing results...';

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    progressFill.style.width = '100%';
    progressText.textContent = 'Complete!';

    result.className = 'result success';
    result.innerHTML = `
      ✅ <strong>${data.added}</strong> new prospects imported<br>
      📊 ${data.fetched} fetched from ${data.pages_loaded} page(s)<br>
      ${data.skipped > 0 ? `⏭️ ${data.skipped} duplicates skipped<br>` : ''}
      ${data.has_more ? `📄 More results available (${data.total_found} total)` : ''}
    `;
    result.style.display = 'block';

    btn.textContent = '✅ Import Complete';
    setTimeout(() => {
      btn.textContent = '🎯 Import More';
      btn.disabled = false;
    }, 3000);

  } catch (error) {
    progressFill.style.width = '100%';
    progressFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    progressText.textContent = 'Import failed';

    result.className = 'result error';
    result.textContent = `❌ Error: ${error.message}`;
    result.style.display = 'block';

    btn.textContent = '🔄 Retry Import';
    btn.disabled = false;
  }
}
