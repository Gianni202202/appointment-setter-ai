// ============================================
// Elvatix — Content Script for Sales Navigator
// Detects search pages and communicates with popup
// ============================================

(function() {
  'use strict';

  // Detect Sales Navigator search page
  function isSalesNavSearch() {
    return window.location.href.includes('/sales/search/') || 
           window.location.href.includes('/sales/lists/');
  }

  // Get search info from the page
  function getSearchInfo() {
    const url = window.location.href;
    let info = { url, type: 'unknown', query: '' };

    if (url.includes('/sales/search/people')) {
      info.type = 'people';
    } else if (url.includes('/sales/search/company')) {
      info.type = 'company';
    } else if (url.includes('/sales/lists/people')) {
      info.type = 'lead_list';
    }

    // Try to get result count from page
    const resultCountEl = document.querySelector('.search-results__result-count, [data-anonymize="results-count"]');
    if (resultCountEl) {
      info.resultCount = resultCountEl.textContent.trim();
    }

    return info;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getSearchInfo') {
      sendResponse(getSearchInfo());
    }
    if (message.action === 'getCurrentUrl') {
      sendResponse({ url: window.location.href });
    }
    return true;
  });

  // Inject a subtle indicator when on a search page
  if (isSalesNavSearch()) {
    const indicator = document.createElement('div');
    indicator.id = 'elvatix-indicator';
    indicator.innerHTML = '🎯 Elvatix Ready';
    indicator.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      color: white; padding: 8px 16px; border-radius: 20px;
      font-size: 13px; font-weight: 600; font-family: -apple-system, sans-serif;
      box-shadow: 0 4px 12px rgba(99,102,241,0.3);
      cursor: pointer; opacity: 0.9; transition: all 0.2s;
    `;
    indicator.addEventListener('mouseenter', () => { indicator.style.opacity = '1'; indicator.style.transform = 'scale(1.05)'; });
    indicator.addEventListener('mouseleave', () => { indicator.style.opacity = '0.9'; indicator.style.transform = 'scale(1)'; });
    indicator.addEventListener('click', () => { chrome.runtime.sendMessage({ action: 'openPopup' }); });
    
    // Fade in after 1s
    indicator.style.opacity = '0';
    document.body.appendChild(indicator);
    setTimeout(() => { indicator.style.opacity = '0.9'; }, 1000);
    
    // Auto-hide after 5s
    setTimeout(() => {
      indicator.style.transition = 'opacity 0.5s';
      indicator.style.opacity = '0';
      setTimeout(() => indicator.remove(), 500);
    }, 5000);
  }
})();
