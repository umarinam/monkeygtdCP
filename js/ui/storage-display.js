'use strict';

/**
 * Storage Display UI
 * Shows current localStorage usage and quota information
 */

function getStorageSize() {
  try {
    const data = localStorage.getItem('mgtd3');
    if (!data) return 0;
    // Rough estimate: JSON string length in bytes (UTF-8)
    return new TextEncoder().encode(data).byteLength;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function showStorageUsageUi(app, S) {
  const el = document.getElementById('storage-usage');
  if (!el) return;
  
  // Get actual mgtd3 data size (most important)
  const actualSize = getStorageSize();
  
  // Try to use navigator.storage.estimate() for quota context
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      // Use actual mgtd3 size if estimate shows 0 (persistent storage not granted)
      const displayUsage = usage > 0 ? usage : actualSize;
      const usagePercent = Math.round((displayUsage / quota) * 100);
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span>Data stored:</span>
          <strong>${formatBytes(displayUsage)}</strong>
        </div>
        <div style="width:100%;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;background:var(--primary);width:${Math.min(usagePercent, 100)}%;transition:width 0.3s"></div>
        </div>
        <div style="font-size:11px;color:var(--fg2);text-align:right">${usagePercent}% of ${formatBytes(quota)}</div>
      `;
    }).catch(() => {
      // Fallback: just show mgtd3 size
      el.innerHTML = `<div>Data stored: ${formatBytes(actualSize)}</div>`;
    });
  } else {
    // Fallback for browsers without storage.estimate()
    el.innerHTML = `<div>Data stored: ${formatBytes(actualSize)}</div>`;
  }
}

function clearAllDataUi(app, S) {
  if (!confirm('Clear ALL app data and reset? This cannot be undone.')) return;
  try {
    localStorage.removeItem('mgtd3');
    app.toast('✓ Data cleared. Reload to reset app.');
  } catch(e) {
    app.toast('✗ Error clearing data: ' + e.message);
  }
}
