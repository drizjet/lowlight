// background.js - Centralized logic for applying styles reliably.

/**
 * Initializes or updates the activeWindowId in storage.
 */
async function updateActiveWindow() {
    try {
        const lastFocused = await chrome.windows.getLastFocused({ populate: false, windowTypes: ['normal'] });
        if (lastFocused?.id) {
            await chrome.storage.local.set({ activeWindowId: lastFocused.id });
        }
    } catch (e) {
        console.error("Could not update active window:", e);
    }
}

/**
 * The single source of truth for applying styles to tabs.
 * It fetches the latest settings from storage and sends them to the content scripts.
 */
async function applyStylesToTabs() {
    try {
        const settings = await chrome.storage.local.get([
            'contrastEnabled', 'contrastLevel', 'brightnessLevel', 'saturationLevel', 'scope', 'activeWindowId'
        ]);

        // Define and merge with defaults to prevent errors if storage is empty.
        const finalSettings = {
            contrastEnabled: false,
            contrastLevel: 100,
            brightnessLevel: 100,
            saturationLevel: 100,
            scope: 'all',
            ...settings
        };
        
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });

        for (const tab of tabs) {
            // Determine if the styles should be applied to this specific tab
            let apply = false;
            if (finalSettings.contrastEnabled) {
                if (finalSettings.scope === 'all') {
                    apply = true; // Apply to all tabs if scope is 'all'
                } else if (finalSettings.scope === 'window' && tab.windowId === finalSettings.activeWindowId) {
                    apply = true; // Apply only if the tab is in the active window
                }
            }

            chrome.tabs.sendMessage(tab.id, {
                action: 'applyStyle',
                enabled: apply,
                level: finalSettings.contrastLevel,
                brightness: finalSettings.brightnessLevel,
                saturation: finalSettings.saturationLevel
            }).catch(error => {
                if (!error.message.includes("Receiving end does not exist")) {
                    // console.warn(`Tab ${tab.id} not receptive.`);
                }
            });
        }
    } catch (e) {
        console.error("Error in applyStylesToTabs:", e);
    }
}

// --- Event Listeners ---

// On first install, set all default values in storage.
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await chrome.storage.local.set({ 
            contrastEnabled: false, 
            contrastLevel: 100, 
            brightnessLevel: 100, 
            saturationLevel: 100,
            scope: 'all'
        });
    }
    await updateActiveWindow();
    applyStylesToTabs();
});

// On browser startup, find the active window and apply styles.
chrome.runtime.onStartup.addListener(async () => {
    await updateActiveWindow();
    applyStylesToTabs();
});

// THIS IS THE CORE TRIGGER: When the popup saves settings, this fires.
chrome.storage.onChanged.addListener(applyStylesToTabs);

// Also apply styles when tabs are updated or windows are changed.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
        applyStylesToTabs();
    }
});

// When the user switches windows, update the active ID AND re-apply styles.
// This is crucial for "window" scope to follow the user's focus and ensures
// the extension state remains consistent.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    // A value of -1 (chrome.windows.WINDOW_ID_NONE) means no window is focused.
    if (windowId > 0) {
        await updateActiveWindow();
        await applyStylesToTabs();
    }
});

chrome.windows.onCreated.addListener(applyStylesToTabs);

// Listener for keyboard shortcuts.
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-contrast') {
    const { contrastEnabled } = await chrome.storage.local.get('contrastEnabled');
    await chrome.storage.local.set({ contrastEnabled: !contrastEnabled });
  }
});

// A content script might load late and ask for the current settings.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getCurrentSettings') {
    applyStylesToTabs();
  }
  return true;
}); 