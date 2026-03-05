// Background service worker for the journal extension

// Initialize settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['settings'], (result) => {
    if (!result.settings) {
      const defaultSettings = {
        wordsRequired: 50,
        promptsPerDay: 3,
        enabled: true
      };
      chrome.storage.sync.set({ settings: defaultSettings });
      schedulePrompts(defaultSettings);
    } else {
      schedulePrompts(result.settings);
    }
  });
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.settings) {
    schedulePrompts(changes.settings.newValue);
  }
});

// Schedule random prompts throughout the day
function schedulePrompts(settings) {
  if (!settings.enabled) {
    chrome.alarms.clearAll();
    return;
  }

  chrome.alarms.clearAll();
  
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  
  // Generate random times for prompts
  const promptTimes = generateRandomTimes(settings.promptsPerDay, now, endOfDay);
  
  promptTimes.forEach((time, index) => {
    const delayInMinutes = (time - now) / 1000 / 60;
    if (delayInMinutes > 0) {
      chrome.alarms.create(`journal-prompt-${index}`, {
        when: time.getTime()
      });
    }
  });

  // Schedule next day's prompts
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 30);
  chrome.alarms.create('schedule-next-day', {
    when: tomorrowStart.getTime()
  });
}

// Generate random times between now and end of day
function generateRandomTimes(count, start, end) {
  const times = [];
  const startTime = start.getTime();
  const endTime = end.getTime();
  const range = endTime - startTime;
  
  for (let i = 0; i < count; i++) {
    const randomTime = new Date(startTime + Math.random() * range);
    times.push(randomTime);
  }
  
  return times.sort((a, b) => a - b);
}

// Handle alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'schedule-next-day') {
    chrome.storage.sync.get(['settings'], (result) => {
      if (result.settings) {
        schedulePrompts(result.settings);
      }
    });
  } else if (alarm.name.startsWith('journal-prompt-')) {
    // Trigger the journal prompt
    chrome.storage.sync.get(['settings'], (result) => {
      if (result.settings && result.settings.enabled) {
        const promptId = `prompt-${Date.now()}`;
        // Send message to active tab to show prompt
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && !tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('chrome-extension://')) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SHOW_JOURNAL_PROMPT',
              wordsRequired: result.settings.wordsRequired,
              promptId: promptId
            }).catch(() => {
              // Content script not loaded, inject it
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ['content.js']
              }).then(() => {
                chrome.scripting.insertCSS({
                  target: { tabId: tabs[0].id },
                  files: ['content.css']
                }).then(() => {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'SHOW_JOURNAL_PROMPT',
                    wordsRequired: result.settings.wordsRequired,
                    promptId: promptId
                  });
                });
              }).catch((error) => {
                console.log('Cannot inject on this page:', error);
              });
            });
          }
        });
      }
    });
  } else if (alarm.name.startsWith('snooze-')) {
    // Handle snoozed prompt
    const promptId = alarm.name.replace('snooze-', '');
    chrome.storage.local.get(['currentDraft'], (result) => {
      if (result.currentDraft && result.currentDraft.promptId === promptId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && !tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('chrome-extension://')) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'RESUME_DRAFT'
            }).catch(() => {
              // Will show draft next time they browse
            });
          }
        });
      }
    });
  }
});

// Listen for manual trigger from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MANUAL_PROMPT') {
    chrome.storage.sync.get(['settings'], (result) => {
      const promptId = `prompt-${Date.now()}`;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && !tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('chrome-extension://')) {
          // Try to send message, if it fails, inject the content script first
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SHOW_JOURNAL_PROMPT',
            wordsRequired: result.settings.wordsRequired,
            promptId: promptId
          }).catch(() => {
            // Content script not loaded, inject it
            chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js']
            }).then(() => {
              chrome.scripting.insertCSS({
                target: { tabId: tabs[0].id },
                files: ['content.css']
              }).then(() => {
                // Now send the message
                chrome.tabs.sendMessage(tabs[0].id, {
                  type: 'SHOW_JOURNAL_PROMPT',
                  wordsRequired: result.settings.wordsRequired,
                  promptId: promptId
                });
              });
            }).catch((error) => {
              console.log('Cannot inject on this page:', error);
            });
          });
        }
      });
    });
  } else if (message.type === 'SNOOZE_PROMPT') {
    // Schedule to reappear in 10 minutes
    chrome.alarms.create(`snooze-${message.promptId}`, {
      delayInMinutes: 10
    });
  } else if (message.type === 'CHECK_FOR_DRAFT') {
    // Check if there's a pending draft
    chrome.storage.local.get(['currentDraft'], (result) => {
      sendResponse({ hasDraft: !!result.currentDraft, draft: result.currentDraft });
    });
    return true; // Keep channel open for async response
  }
});
