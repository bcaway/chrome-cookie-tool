/**
 * BCA Absence Sync Cookie Tool - Background Service Worker (Manifest V3)
 *
 * Ephemeral background worker that reads Google Docs session cookies
 * and synchronizes them to the Google Apps Script Web App endpoint.
 */

const DEFAULT_DOC_URL =
  "https://docs.google.com/document/d/e/2PACX-1vRkhySmwAiTtY88tcshckpV4F0vRrULccaGrYl_Sf2ubWpyyXA4l8c-KAOuMzSwFe-qyAQhLqXzVsbA/pub?not_in_iframe=true";
const ALARM_NAME = "bca-absence-sync-alarm";
const DEFAULT_INTERVAL_MINUTES = 30;

/**
 * Retrieves extension settings from chrome.storage.local with defaults.
 */
async function getConfig() {
  const defaults = {
    webAppUrl: "",
    docUrl: DEFAULT_DOC_URL,
    secret: "",
    syncIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
    autoSync: true,
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

/**
 * Gathers relevant Google session cookies for the target Google Doc URL.
 * Combines URL-specific cookies with docs.google.com and google.com cookies.
 */
async function getGoogleCookies(targetUrl) {
  const cookieMap = new Map();

  const addCookies = (list) => {
    if (!list) return;
    for (const c of list) {
      if (c && c.name && c.value) {
        cookieMap.set(c.name, c.value);
      }
    }
  };

  try {
    // 1. Cookies matching the exact doc URL
    const urlCookies = await chrome.cookies.getAll({ url: targetUrl });
    addCookies(urlCookies);
  } catch (err) {
    console.warn("Error getting cookies by URL:", err);
  }

  try {
    // 2. Specific docs.google.com cookies (e.g. OSID, __Secure-OSID)
    const docsCookies = await chrome.cookies.getAll({ domain: "docs.google.com" });
    addCookies(docsCookies);
  } catch (err) {
    console.warn("Error getting docs.google.com cookies:", err);
  }

  try {
    // 3. .google.com cookies (with leading dot)
    const dotGoogleCookies = await chrome.cookies.getAll({ domain: ".google.com" });
    addCookies(dotGoogleCookies);
  } catch (err) {
    console.warn("Error getting .google.com cookies:", err);
  }

  try {
    // 4. Root google.com auth cookies
    const rootCookies = await chrome.cookies.getAll({ domain: "google.com" });
    addCookies(rootCookies);
  } catch (err) {
    console.warn("Error getting google.com cookies:", err);
  }

  const cookiesList = [];
  for (const [name, value] of cookieMap.entries()) {
    cookiesList.push({ name, value });
  }

  const names = cookiesList.map((c) => c.name);
  console.log(`Gathered ${cookiesList.length} session cookie(s): ${names.join(", ")}`);
  return cookiesList;
}

/**
 * Builds standard Cookie HTTP header string: name=value; name2=value2
 */
function formatCookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Synchronizes cookies and document HTML with the configured Google Apps Script Web App.
 *
 * @param {Object} options
 * @param {boolean} [options.triggerSync] Whether Apps Script should run an immediate syncDocToSheets()
 * @param {boolean} [options.manual] Whether this was initiated manually by the user
 */
async function syncCookies(options = {}) {
  const config = await getConfig();

  if (!config.webAppUrl || !config.webAppUrl.trim()) {
    const errorMsg = "Web App URL is not configured. Open extension settings to paste your Apps Script URL.";
    await chrome.storage.local.set({
      lastSyncStatus: "unconfigured",
      lastSyncTime: new Date().toISOString(),
      lastSyncMessage: errorMsg,
    });
    return { success: false, status: "unconfigured", message: errorMsg };
  }

  const targetDocUrl = (config.docUrl && config.docUrl.trim()) || DEFAULT_DOC_URL;

  try {
    // 1. Gather all Google session cookies
    const cookies = await getGoogleCookies(targetDocUrl);
    const cookieString = cookies && cookies.length > 0 ? formatCookieHeader(cookies) : "";

    // 2. Attempt direct Chrome fetch with not_in_iframe=true
    let docHtml = null;
    let fetchUrl = targetDocUrl;
    if (!fetchUrl.includes("not_in_iframe=true")) {
      fetchUrl += (fetchUrl.includes("?") ? "&" : "?") + "not_in_iframe=true";
    }

    try {
      console.log("Attempting direct fetch within Chrome from:", fetchUrl);
      const docResp = await fetch(fetchUrl, {
        credentials: "include",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const text = await docResp.text();
      console.log(`Direct Chrome fetch returned HTTP ${docResp.status}, length: ${text.length}`);
      if (
        docResp.status === 200 &&
        (text.includes("BCA Class Cancellation List") ||
          (text.includes("Cancellation") && text.includes("<table")) ||
          (text.includes("<table") && text.includes("Teacher")))
      ) {
        docHtml = text;
        console.log("Direct Chrome fetch succeeded! Document HTML captured.");
      }
    } catch (fetchErr) {
      console.warn("Direct Chrome fetch error:", fetchErr);
    }

    // 3. Fallback: Check if any open Chrome tab has the cancellation document loaded
    if (!docHtml) {
      try {
        const tabs = await chrome.tabs.query({ url: "*://docs.google.com/document/d/e/*" });
        if (tabs && tabs.length > 0) {
          console.log(`Found ${tabs.length} open cancellation doc tab(s). Extracting rendered DOM...`);
          const injection = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => document.documentElement.outerHTML,
          });
          if (injection && injection[0] && injection[0].result) {
            const tabHtml = injection[0].result;
            if (tabHtml.includes("Cancellation") || tabHtml.includes("<table")) {
              docHtml = tabHtml;
              console.log("Successfully extracted cancellation HTML from open Chrome tab!");
            }
          }
        }
      } catch (tabErr) {
        console.warn("Could not extract from open tab:", tabErr);
      }
    }

    if (!cookieString && !docHtml) {
      const errorMsg =
        "No Google session cookies found. Please ensure you are logged into your @bergen.org Google account in Chrome.";
      await chrome.storage.local.set({
        lastSyncStatus: "error",
        lastSyncTime: new Date().toISOString(),
        lastSyncMessage: errorMsg,
        cookieCount: 0,
      });
      await updateActionBadge("ERR", "#EA4335");
      return { success: false, status: "error", message: errorMsg };
    }

    const payload = {
      cookie: cookieString || undefined,
      html: docHtml || undefined,
      secret: (config.secret && config.secret.trim()) || undefined,
      triggerSync: !!options.triggerSync,
    };

    console.log(
      `Sending payload to Web App (${cookies.length} cookie(s), directHtml: ${!!docHtml}): ${config.webAppUrl}`
    );

    const response = await fetch(config.webAppUrl.trim(), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
      redirect: "follow",
    });

    const responseText = await response.text();
    let resultJson = null;

    try {
      resultJson = JSON.parse(responseText);
    } catch {
      // Sometimes Apps Script returns HTML or redirect text
      if (response.ok && responseText.includes("success")) {
        resultJson = { status: "success", message: "Cookie updated successfully." };
      } else {
        resultJson = {
          status: response.ok ? "success" : "error",
          message: responseText.slice(0, 200),
        };
      }
    }

    if (resultJson && resultJson.status === "success") {
      const successMsg = resultJson.message || "Cookie synchronized successfully.";
      const nowIso = new Date().toISOString();
      await chrome.storage.local.set({
        lastSyncStatus: "success",
        lastSyncTime: nowIso,
        lastSyncMessage: successMsg,
        cookieCount: cookies.length,
      });

      await updateActionBadge("OK", "#34A853");
      return {
        success: true,
        status: "success",
        message: successMsg,
        updatedAt: nowIso,
        cookieCount: cookies.length,
      };
    } else {
      const errorMsg =
        (resultJson && resultJson.message) ||
        `Server returned status ${response.status}: ${responseText.slice(0, 150)}`;

      await chrome.storage.local.set({
        lastSyncStatus: "error",
        lastSyncTime: new Date().toISOString(),
        lastSyncMessage: errorMsg,
        cookieCount: cookies.length,
      });

      await updateActionBadge("ERR", "#EA4335");
      return { success: false, status: "error", message: errorMsg };
    }
  } catch (err) {
    console.error("Cookie sync failed with exception:", err);
    const errorMsg = `Sync network error: ${err.message}`;
    await chrome.storage.local.set({
      lastSyncStatus: "error",
      lastSyncTime: new Date().toISOString(),
      lastSyncMessage: errorMsg,
    });
    await updateActionBadge("ERR", "#EA4335");
    return { success: false, status: "error", message: errorMsg };
  }
}

/**
 * Updates extension action badge text and background color.
 */
async function updateActionBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    if (color) {
      await chrome.action.setBadgeBackgroundColor({ color });
    }
  } catch (err) {
    console.warn("Could not set action badge:", err);
  }
}

/**
 * Configures the periodic chrome.alarms schedule based on user settings.
 */
async function updateAlarmSchedule() {
  const config = await getConfig();
  await chrome.alarms.clear(ALARM_NAME);

  if (config.autoSync) {
    const minutes = Math.max(5, parseInt(config.syncIntervalMinutes, 10) || DEFAULT_INTERVAL_MINUTES);
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
    console.log(`Configured sync alarm every ${minutes} minute(s).`);
  } else {
    console.log("Auto-sync is disabled. Alarm removed.");
  }
}

// Lifecycle listeners
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BCA Absence Sync Cookie Tool installed/updated:", details.reason);
  await updateAlarmSchedule();

  const config = await getConfig();
  if (config.webAppUrl) {
    // Run an initial sync on install/update if configured
    await syncCookies({ triggerSync: false });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("Browser startup: checking cookie sync schedule.");
  await updateAlarmSchedule();

  const config = await getConfig();
  if (config.webAppUrl && config.autoSync) {
    await syncCookies({ triggerSync: false });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("Alarm triggered: executing automatic cookie sync.");
    await syncCookies({ triggerSync: false });
  }
});

// Communication with popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SYNC_NOW") {
    (async () => {
      const result = await syncCookies({
        triggerSync: !!message.triggerSync,
        manual: true,
      });
      sendResponse(result);
    })();
    return true; // Keep message channel open for async response
  }

  if (message.type === "GET_STATUS") {
    (async () => {
      const config = await getConfig();
      const statusData = await chrome.storage.local.get([
        "lastSyncStatus",
        "lastSyncTime",
        "lastSyncMessage",
        "cookieCount",
      ]);

      // Count currently available cookies
      let liveCookieCount = 0;
      try {
        const cookies = await getGoogleCookies(config.docUrl || DEFAULT_DOC_URL);
        liveCookieCount = cookies.length;
      } catch (e) {
        console.warn("Error counting live cookies:", e);
      }

      sendResponse({
        config,
        status: statusData.lastSyncStatus || "idle",
        lastSyncTime: statusData.lastSyncTime || null,
        lastSyncMessage: statusData.lastSyncMessage || null,
        cookieCount: statusData.cookieCount ?? liveCookieCount,
        liveCookieCount,
      });
    })();
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    (async () => {
      const newSettings = message.settings || {};
      await chrome.storage.local.set(newSettings);
      await updateAlarmSchedule();

      // If user provided a Web App URL, run an immediate sync
      let syncResult = null;
      if (newSettings.webAppUrl) {
        syncResult = await syncCookies({ triggerSync: false });
      }

      sendResponse({ success: true, syncResult });
    })();
    return true;
  }

  if (message.type === "CLEAR_BADGE") {
    (async () => {
      await updateActionBadge("", null);
      sendResponse({ success: true });
    })();
    return true;
  }
});
