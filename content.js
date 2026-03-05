// Content script - runs on all web pages

let journalOverlay = null;
let inactivityTimeout = null;
let dismissTimeout = null;
let lastInteractionTime = Date.now();
let currentPromptId = null;
let hasSnoozeBeenUsed = false;
let currentDraft = '';

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

async function loadEntries() {
  const data = await chrome.storage.sync.get(null);
  
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

async function addEntry(entry) {
  const entries = await loadEntries();
  entries.push(entry);
  await saveEntries(entries);
}

// Track user activity
document.addEventListener('mousemove', () => {
  lastInteractionTime = Date.now();
});
document.addEventListener('keydown', () => {
  lastInteractionTime = Date.now();
});
document.addEventListener('click', () => {
  lastInteractionTime = Date.now();
});

// Check for inactivity every minute
setInterval(() => {
  const inactiveMinutes = (Date.now() - lastInteractionTime) / 1000 / 60;
  
  // If inactive for 60 minutes and prompt is showing, auto-dismiss
  if (journalOverlay && inactiveMinutes >= 60) {
    markAsMissed('auto-dismissed after 60 min inactivity');
    closeJournalPrompt();
  }
}, 60000); // Check every minute

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_JOURNAL_PROMPT') {
    showJournalPrompt(message.wordsRequired, message.promptId);
  } else if (message.type === 'RESUME_DRAFT') {
    // Check if there's a draft to resume
    chrome.storage.sync.get(['currentDraft'], (result) => {
      if (result.currentDraft) {
        showJournalPrompt(result.currentDraft.wordsRequired, result.currentDraft.promptId, result.currentDraft.text);
      }
    });
  }
});

function showJournalPrompt(wordsRequired, promptId, draftText = '') {
  // Don't show if already showing
  if (journalOverlay) return;

  currentPromptId = promptId || Date.now().toString();
  hasSnoozeBeenUsed = false;
  
  // Clear any existing timeouts
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  if (dismissTimeout) clearTimeout(dismissTimeout);

  // Set 10-minute inactivity timeout to mark as missed
  inactivityTimeout = setTimeout(() => {
    if (journalOverlay) {
      markAsMissed('no interaction for 10 minutes');
      closeJournalPrompt();
    }
  }, 10 * 60 * 1000); // 10 minutes

  // Create overlay
  journalOverlay = document.createElement('div');
  journalOverlay.className = 'soc-journal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'soc-journal-modal';
  
  const header = document.createElement('div');
  header.className = 'soc-journal-header';
  header.innerHTML = `
    <h2>🌊 Currents</h2>
    <div class="soc-header-actions">
      <button class="soc-snooze-btn" id="socSnoozeBtn">Snooze 10 min</button>
      <button class="soc-close-btn" id="socCloseBtn">×</button>
    </div>
  `;
  
  const content = document.createElement('div');
  content.className = 'soc-journal-content';
  
  const instructionText = draftText ? 
    `<p class="soc-instruction"><strong>Continue your entry</strong> - You need <strong>${wordsRequired} words</strong> total.</p>` :
    `<p class="soc-instruction">Write <strong>${wordsRequired} words</strong> off the top of your head. Don't think, just write.</p>`;
  
  content.innerHTML = `
    ${instructionText}
    <textarea id="socJournalText" class="soc-textarea" placeholder="Start typing...">${draftText}</textarea>
    <div class="soc-footer">
      <span class="soc-word-count" id="socWordCount">0 / ${wordsRequired} words</span>
      <button class="soc-submit-btn" id="socSubmitBtn" disabled>Save Entry</button>
    </div>
  `;
  
  modal.appendChild(header);
  modal.appendChild(content);
  journalOverlay.appendChild(modal);
  document.body.appendChild(journalOverlay);
  
  // Focus on textarea
  const textarea = document.getElementById('socJournalText');
  textarea.focus();
  
  // Update word count for draft text
  if (draftText) {
    updateWordCount(textarea, wordsRequired);
  }
  
  // Word count tracking
  textarea.addEventListener('input', () => {
    updateWordCount(textarea, wordsRequired);
    saveDraft(textarea.value, wordsRequired);
    
    // Reset inactivity timeout on typing
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
      if (journalOverlay) {
        markAsMissed('no interaction for 10 minutes');
        closeJournalPrompt();
      }
    }, 10 * 60 * 1000);
  });
  
  // Snooze button
  document.getElementById('socSnoozeBtn').addEventListener('click', () => {
    if (!hasSnoozeBeenUsed) {
      snoozePrompt(textarea.value, wordsRequired);
    }
  });
  
  // Close button
  document.getElementById('socCloseBtn').addEventListener('click', () => {
    saveDraft(textarea.value, wordsRequired);
    closeJournalPrompt();
  });
  
  // Submit button
  document.getElementById('socSubmitBtn').addEventListener('click', () => {
    saveJournalEntry(textarea.value, wordsRequired);
  });
  
  // Close on overlay click
  journalOverlay.addEventListener('click', (e) => {
    if (e.target === journalOverlay) {
      saveDraft(textarea.value, wordsRequired);
      closeJournalPrompt();
    }
  });
}

function updateWordCount(textarea, wordsRequired) {
  const words = countWords(textarea.value);
  const wordCountEl = document.getElementById('socWordCount');
  const submitBtn = document.getElementById('socSubmitBtn');
  
  if (wordCountEl && submitBtn) {
    wordCountEl.textContent = `${words} / ${wordsRequired} words`;
    
    if (words >= wordsRequired) {
      wordCountEl.classList.add('soc-complete');
      submitBtn.disabled = false;
    } else {
      wordCountEl.classList.remove('soc-complete');
      submitBtn.disabled = true;
    }
  }
}

function closeJournalPrompt() {
  if (journalOverlay) {
    journalOverlay.remove();
    journalOverlay = null;
  }
  
  // Clear timeouts
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }
  if (dismissTimeout) {
    clearTimeout(dismissTimeout);
    dismissTimeout = null;
  }
}

function snoozePrompt(draftText, wordsRequired) {
  if (hasSnoozeBeenUsed) return;
  
  hasSnoozeBeenUsed = true;
  
  // Save draft
  saveDraft(draftText, wordsRequired);
  
  // Schedule to reappear in 10 minutes
  chrome.runtime.sendMessage({
    type: 'SNOOZE_PROMPT',
    promptId: currentPromptId,
    wordsRequired: wordsRequired,
    draftText: draftText
  });
  
  closeJournalPrompt();
  showSuccessMessage('⏰ Snoozed for 10 minutes');
}

function saveDraft(text, wordsRequired) {
  if (!text.trim()) {
    // No text, clear draft
    chrome.storage.sync.remove(['currentDraft']);
    return;
  }
  
  const draft = {
    text: text,
    wordsRequired: wordsRequired,
    promptId: currentPromptId,
    timestamp: new Date().toISOString()
  };
  
  chrome.storage.sync.set({ currentDraft: draft });
}

function markAsMissed(reason) {
  const missedEntry = {
    promptId: currentPromptId,
    reason: reason,
    timestamp: new Date().toISOString(),
    url: window.location.href
  };
  
  chrome.storage.sync.get(['missedPrompts'], (result) => {
    const missed = result.missedPrompts || [];
    missed.push(missedEntry);
    chrome.storage.sync.set({ missedPrompts: missed });
  });
}

function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function saveJournalEntry(text, wordsRequired) {
  const entry = {
    text: text,
    wordCount: countWords(text),
    wordsRequired: wordsRequired,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    promptId: currentPromptId
  };
  
  // Use chunked storage
  addEntry(entry).then(() => {
    // Clear the draft since entry is complete
    chrome.storage.sync.remove(['currentDraft']);
    showSuccessMessage('✓ Entry saved!');
    closeJournalPrompt();
  }).catch(error => {
    console.error('Error saving entry:', error);
    showSuccessMessage('❌ Error saving entry');
  });
}

function showSuccessMessage(message = '✓ Entry saved!') {
  const successMsg = document.createElement('div');
  successMsg.className = 'soc-success-message';
  successMsg.textContent = message;
  document.body.appendChild(successMsg);
  
  setTimeout(() => {
    successMsg.classList.add('soc-fade-out');
    setTimeout(() => successMsg.remove(), 300);
  }, 2000);
}
