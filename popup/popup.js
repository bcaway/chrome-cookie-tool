/**
 * BCA Absence Sync Cookie Tool - Popup UI Logic
 */

const DEFAULT_DOC_URL =
  "https://docs.google.com/document/d/e/2PACX-1vRkhySmwAiTtY88tcshckpV4F0vRrULccaGrYl_Sf2ubWpyyXA4l8c-KAOuMzSwFe-qyAQhLqXzVsbA/pub?not_in_iframe=true";

// DOM Elements
const statusBadge = document.getElementById("status-badge");
const cookieStatusText = document.getElementById("cookie-status-text");
const lastSyncTimeEl = document.getElementById("last-sync-time");
const statusMessageBox = document.getElementById("status-message-box");
const statusMessageText = document.getElementById("status-message-text");

const btnSync = document.getElementById("btn-sync");
const syncIcon = document.getElementById("sync-icon");
const btnSyncText = document.getElementById("btn-sync-text");
const btnOpenDoc = document.getElementById("btn-open-doc");
const chkTriggerSync = document.getElementById("chk-trigger-sync");

const btnToggleSettings = document.getElementById("btn-toggle-settings");
const settingsToggleIcon = document.getElementById("settings-toggle-icon");
const settingsPanel = document.getElementById("settings-panel");

const inputWebAppUrl = document.getElementById("input-webapp-url");
const inputSecret = document.getElementById("input-secret");
const selectInterval = document.getElementById("select-interval");
const chkAutosync = document.getElementById("chk-autosync");
const inputAuthUser = document.getElementById("input-authuser");
const inputDocUrl = document.getElementById("input-doc-url");
const btnResetDocUrl = document.getElementById("btn-reset-doc-url");
const btnSaveSettings = document.getElementById("btn-save-settings");
const saveStatus = document.getElementById("save-status");

/**
 * Formats an ISO date string into a friendly, human-readable timestamp.
 */
function formatTime(isoString) {
  if (!isoString) return "Never";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Never";

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 45) return "Just now";
    if (diffSec < 120) return "1 min ago";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mins ago`;

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) {
      return `Today at ${timeStr}`;
    }

    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  } catch {
    return "Never";
  }
}

/**
 * Updates the UI based on status and settings response from service worker.
 */
function updateUiWithStatus(data) {
  const { config, status, lastSyncTime, lastSyncMessage, cookieCount, liveCookieCount } = data;

  // Cookie count display
  const count = liveCookieCount ?? cookieCount ?? 0;
  if (count > 0) {
    cookieStatusText.textContent = `${count} active cookie(s) detected`;
    cookieStatusText.style.color = "var(--success)";
  } else {
    cookieStatusText.textContent = "No Google cookies detected";
    cookieStatusText.style.color = "var(--danger)";
  }

  // Last sync timestamp
  lastSyncTimeEl.textContent = formatTime(lastSyncTime);

  // Status badge & message box
  statusBadge.className = "badge";
  statusMessageBox.className = "message-box message-box-hidden";
  statusMessageText.textContent = "";

  if (status === "success") {
    statusBadge.classList.add("badge-success");
    statusBadge.textContent = "Synced";

    if (lastSyncMessage) {
      statusMessageBox.className = "message-box msg-success";
      statusMessageText.textContent = lastSyncMessage;
    }
  } else if (status === "error") {
    statusBadge.classList.add("badge-danger");
    statusBadge.textContent = "Sync Error";

    if (lastSyncMessage) {
      statusMessageBox.className = "message-box msg-error";
      statusMessageText.textContent = lastSyncMessage;
    }
  } else if (status === "unconfigured") {
    statusBadge.classList.add("badge-warning");
    statusBadge.textContent = "Setup Needed";

    statusMessageBox.className = "message-box msg-warning";
    statusMessageText.textContent =
      "Paste your Google Apps Script Web App URL below in Configuration & Settings to start syncing.";

    // Automatically expand settings panel for easy setup
    expandSettings();
  } else {
    statusBadge.classList.add("badge-idle");
    statusBadge.textContent = "Ready";
  }

  // Populate config inputs if provided
  if (config) {
    inputWebAppUrl.value = config.webAppUrl || "";
    inputSecret.value = config.secret || "";
    selectInterval.value = String(config.syncIntervalMinutes || 30);
    chkAutosync.checked = config.autoSync !== false;
    if (inputAuthUser) inputAuthUser.value = config.authUser || "kabsek30@bergen.org";
    inputDocUrl.value = config.docUrl || DEFAULT_DOC_URL;
  }
}

function expandSettings() {
  settingsPanel.classList.remove("collapsed");
  settingsToggleIcon.textContent = "▾";
}

function collapseSettings() {
  settingsPanel.classList.add("collapsed");
  settingsToggleIcon.textContent = "▸";
}

/**
 * Loads current status and configuration from service worker.
 */
async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (response) {
      updateUiWithStatus(response);
    }
  } catch (err) {
    console.error("Failed to load status:", err);
  }
}

/**
 * Triggers manual cookie sync.
 */
async function handleSyncNow() {
  btnSync.disabled = true;
  syncIcon.classList.add("spinning");
  btnSyncText.textContent = "Syncing with Apps Script...";
  statusBadge.className = "badge badge-syncing";
  statusBadge.textContent = "Syncing...";

  try {
    const triggerSync = chkTriggerSync.checked;
    const result = await chrome.runtime.sendMessage({
      type: "SYNC_NOW",
      triggerSync,
    });

    if (result) {
      await loadStatus();
    }
  } catch (err) {
    console.error("Manual sync error:", err);
    statusBadge.className = "badge badge-danger";
    statusBadge.textContent = "Failed";
    statusMessageBox.className = "message-box msg-error";
    statusMessageText.textContent = `Sync failed: ${err.message}`;
  } finally {
    btnSync.disabled = false;
    syncIcon.classList.remove("spinning");
    btnSyncText.textContent = "Sync Cookie Now";
  }
}

/**
 * Saves configuration settings.
 */
async function handleSaveSettings() {
  btnSaveSettings.disabled = true;
  saveStatus.textContent = "Saving...";

  const newSettings = {
    webAppUrl: inputWebAppUrl.value.trim(),
    secret: inputSecret.value.trim(),
    syncIntervalMinutes: parseInt(selectInterval.value, 10) || 30,
    autoSync: chkAutosync.checked,
    authUser: (inputAuthUser ? inputAuthUser.value.trim() : "") || "kabsek30@bergen.org",
    docUrl: inputDocUrl.value.trim() || DEFAULT_DOC_URL,
  };

  try {
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: newSettings,
    });

    saveStatus.textContent = "Saved!";
    saveStatus.style.color = "var(--success)";

    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2500);

    await loadStatus();
  } catch (err) {
    console.error("Error saving settings:", err);
    saveStatus.textContent = "Save failed";
    saveStatus.style.color = "var(--danger)";
  } finally {
    btnSaveSettings.disabled = false;
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Clear any existing action badge when user opens popup
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_BADGE" });
  } catch {
    // Ignore if worker was idle
  }

  await loadStatus();

  btnSync.addEventListener("click", handleSyncNow);
  btnSaveSettings.addEventListener("click", handleSaveSettings);

  if (btnOpenDoc) {
    btnOpenDoc.addEventListener("click", () => {
      const url = inputDocUrl.value.trim() || DEFAULT_DOC_URL;
      chrome.tabs.create({ url });
    });
  }

  btnToggleSettings.addEventListener("click", () => {
    if (settingsPanel.classList.contains("collapsed")) {
      expandSettings();
    } else {
      collapseSettings();
    }
  });

  btnResetDocUrl.addEventListener("click", () => {
    inputDocUrl.value = DEFAULT_DOC_URL;
  });
});
