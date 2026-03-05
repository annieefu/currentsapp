// Popup script

// Storage helper constants
const CHUNK_SIZE = 10; // Entries per chunk

// Chunked storage helpers
async function saveEntries(entries) {
  // Clear existing chunks
  const allData = await chrome.storage.sync.get(null);
  const chunkKeys = Object.keys(allData).filter(key => key.startsWith('entries_chunk_'));
  
  if (chunkKeys.length > 0) {
    await chrome.storage.sync.remove(chunkKeys);
  }
  
  // Split into chunks
  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE));
  }
  
  // Save metadata and chunks
  const saveData = {
    entries_count: entries.length,
    entries_chunks: chunks.length
  };
  
  chunks.forEach((chunk, index) => {
    saveData[`entries_chunk_${index}`] = chunk;
  });
  
  return chrome.storage.sync.set(saveData);
}

async function loadEntriesFromStorage() {
  const data = await chrome.storage.sync.get(null);
  
  // Migration: Check if old format exists
  if (data.journalEntries && Array.isArray(data.journalEntries)) {
    console.log('Migrating old storage format to chunked format...');
    const oldEntries = data.journalEntries;
    await saveEntries(oldEntries);
    await chrome.storage.sync.remove(['journalEntries']);
    console.log(`Migrated ${oldEntries.length} entries to chunked storage`);
    return oldEntries;
  }
  
  if (!data.entries_count || data.entries_count === 0) {
    return [];
  }
  
  const entries = [];
  for (let i = 0; i < data.entries_chunks; i++) {
    const chunk = data[`entries_chunk_${i}`];
    if (chunk) {
      entries.push(...chunk);
    }
  }
  
  return entries;
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadEntries();
  checkForDraft();
  loadMissedPrompts();
  setupEventListeners();
});

function loadSettings() {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      document.getElementById('enabled').checked = result.settings.enabled;
      document.getElementById('wordsRequired').value = result.settings.wordsRequired;
      document.getElementById('promptsPerDay').value = result.settings.promptsPerDay;
    }
  });
}

function loadEntries() {
  loadEntriesFromStorage().then(entries => {
    const entriesList = document.getElementById('entriesList');
    const stats = document.getElementById('stats');
    
    stats.textContent = `Total entries: ${entries.length}`;
    
    if (entries.length === 0) {
      entriesList.innerHTML = '<p class="empty-state">No entries yet. Start journaling!</p>';
      return;
    }
    
    // Show last 3 entries
    const recentEntries = entries.slice(-3).reverse();
    
    entriesList.innerHTML = recentEntries.map(entry => {
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const preview = entry.text.substring(0, 100);
      
      return `
        <div class="entry-item" data-timestamp="${entry.timestamp}">
          <div class="entry-date">${dateStr}</div>
          <div class="entry-preview">${preview}...</div>
          <div class="entry-meta">${entry.wordCount} words</div>
        </div>
      `;
    }).join('');
    
    // Add click handlers to entries
    document.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
        const timestamp = item.dataset.timestamp;
        const entry = entries.find(e => e.timestamp === timestamp);
        if (entry) {
          showEntryModal(entry);
        }
      });
    });
  });
}

function checkForDraft() {
  chrome.storage.sync.get(['currentDraft'], (result) => {
    const draftReminder = document.getElementById('draftReminder');
    if (result.currentDraft) {
      draftReminder.style.display = 'block';
    } else {
      draftReminder.style.display = 'none';
    }
  });
}

function loadMissedPrompts() {
  chrome.storage.sync.get(['missedPrompts'], (result) => {
    const missed = result.missedPrompts || [];
    const missedSection = document.getElementById('missedSection');
    const missedList = document.getElementById('missedList');
    const missedStats = document.getElementById('missedStats');
    
    if (missed.length === 0) {
      missedSection.style.display = 'none';
      return;
    }
    
    missedSection.style.display = 'block';
    missedStats.style.display = 'block';
    missedStats.textContent = `Missed prompts: ${missed.length}`;
    
    // Show last 5 missed prompts
    const recentMissed = missed.slice(-5).reverse();
    
    missedList.innerHTML = recentMissed.map(item => {
      const date = new Date(item.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      return `
        <div class="missed-item">
          <div class="missed-date">${dateStr}</div>
          <div class="missed-reason">${item.reason}</div>
        </div>
      `;
    }).join('');
  });
}

function showEntryModal(entry) {
  const date = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  
  const modal = window.open('', 'Entry', 'width=600,height=400');
  modal.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Journal Entry</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
        }
        h1 {
          font-size: 18px;
          color: #111827;
          margin: 0 0 8px 0;
        }
        .meta {
          color: #6b7280;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .text {
          line-height: 1.6;
          color: #374151;
          white-space: pre-wrap;
        }
        .url {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 12px;
          color: #6b7280;
        }
      </style>
    </head>
    <body>
      <h1>Journal Entry</h1>
      <div class="meta">${dateStr} • ${entry.wordCount} words</div>
      <div class="text">${entry.text}</div>
      <div class="url">Written while browsing: ${entry.url}</div>
    </body>
    </html>
  `);
}

function setupEventListeners() {
  // Save settings
  document.getElementById('saveSettings').addEventListener('click', () => {
    const settings = {
      enabled: document.getElementById('enabled').checked,
      wordsRequired: parseInt(document.getElementById('wordsRequired').value),
      promptsPerDay: parseInt(document.getElementById('promptsPerDay').value)
    };
    
    chrome.storage.sync.set({ settings }, () => {
      showSuccessBanner();
    });
  });
  
  // Test prompt
  document.getElementById('testPrompt').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'MANUAL_PROMPT' });
    window.close();
  });
  
  // Resume draft
  document.getElementById('resumeDraft').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'RESUME_DRAFT' });
      }
    });
    window.close();
  });
  
  // Clear missed prompts
  const clearMissedBtn = document.getElementById('clearMissed');
  if (clearMissedBtn) {
    clearMissedBtn.addEventListener('click', () => {
      chrome.storage.sync.set({ missedPrompts: [] }, () => {
        loadMissedPrompts();
        showSuccessBanner('Missed prompts cleared');
      });
    });
  }
  
  // View all entries
  document.getElementById('viewAll').addEventListener('click', () => {
    loadEntriesFromStorage().then(entries => {
      showAllEntriesPage(entries);
    });
  });
  
  // Export entries
  document.getElementById('exportEntries').addEventListener('click', () => {
    loadEntriesFromStorage().then(entries => {
      exportToJSON(entries);
    });
  });
  
  // Import entries
  document.getElementById('importEntries').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  
  document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importFromJSON(file);
    }
  });
}

function showSuccessBanner(message = '✓ Settings saved!') {
  const banner = document.createElement('div');
  banner.className = 'success-banner';
  banner.textContent = message;
  document.querySelector('.popup-container').insertBefore(banner, document.querySelector('.popup-container').firstChild);
  
  setTimeout(() => {
    banner.remove();
  }, 2000);
}

function showAllEntriesPage(entries) {
  const page = window.open('', 'All Entries', 'width=800,height=600');
  
  const entriesHTML = entries.reverse().map(entry => {
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    return `
      <div class="entry">
        <div class="entry-header">
          <h3>${dateStr}</h3>
          <span class="word-count">${entry.wordCount} words</span>
        </div>
        <div class="entry-text">${entry.text}</div>
        <div class="entry-url">${entry.url}</div>
      </div>
    `;
  }).join('');
  
  page.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>All Journal Entries</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 40px;
          max-width: 900px;
          margin: 0 auto;
          background-color: #f9fafb;
        }
        h1 {
          color: #111827;
          margin-bottom: 30px;
        }
        .entry {
          background: white;
          padding: 24px;
          border-radius: 8px;
          margin-bottom: 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .entry-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid #e5e7eb;
        }
        .entry-header h3 {
          margin: 0;
          font-size: 16px;
          color: #111827;
        }
        .word-count {
          font-size: 12px;
          color: #6b7280;
        }
        .entry-text {
          line-height: 1.6;
          color: #374151;
          white-space: pre-wrap;
          margin-bottom: 12px;
        }
        .entry-url {
          font-size: 11px;
          color: #9ca3af;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </head>
    <body>
      <h1>💭 All Journal Entries (${entries.length})</h1>
      ${entriesHTML}
    </body>
    </html>
  `);
}

function exportToJSON(entries) {
  const dataStr = JSON.stringify(entries, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `journal-entries-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  
  URL.revokeObjectURL(url);
}

function importFromJSON(file) {
  const reader = new FileReader();
  
  reader.onload = async (e) => {
    try {
      const importedEntries = JSON.parse(e.target.result);
      
      // Validate that it's an array
      if (!Array.isArray(importedEntries)) {
        showSuccessBanner('❌ Invalid file format');
        return;
      }
      
      // Get existing entries using chunked storage
      const existingEntries = await loadEntriesFromStorage();
      
      // Merge entries, avoiding duplicates based on timestamp + promptId
      const mergedEntries = [...existingEntries];
      let addedCount = 0;
      
      importedEntries.forEach(importedEntry => {
        // Check if entry already exists (by timestamp and promptId)
        const isDuplicate = existingEntries.some(existing => 
          existing.timestamp === importedEntry.timestamp && 
          existing.promptId === importedEntry.promptId
        );
        
        if (!isDuplicate) {
          mergedEntries.push(importedEntry);
          addedCount++;
        }
      });
      
      // Sort by timestamp
      mergedEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Save merged entries using chunked storage
      await saveEntries(mergedEntries);
      
      showSuccessBanner(`✓ Imported ${addedCount} new entries`);
      loadEntries(); // Refresh the display
      
      // Reset file input
      document.getElementById('importFileInput').value = '';
      
    } catch (error) {
      console.error('Import error:', error);
      showSuccessBanner('❌ Error reading file');
    }
  };
  
  reader.readAsText(file);
}
