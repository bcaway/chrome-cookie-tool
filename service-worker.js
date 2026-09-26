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

// Explicitly filter out foreign subdomain and account chooser cookies
const DISALLOWED_COOKIE_NAMES = new Set([
  "ACCOUNT_CHOOSER",
  "PLAY_ACTIVE_ACCOUNT",
  "GG_ACTIVE_ACCOUNT",
  "GG_XSRF",
  "GMAIL_AT",
  "__Host-GAPS",
  "LSID",
  "__Host-1PLSID",
  "__Host-3PLSID",
  "LSOLH",
  "SNID",
  "SMSV",
  "COMPASS",
]);

const ALLOWED_COOKIE_NAMES = new Set([
  "OSID",
  "__Secure-OSID",
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
  "NID",
  "S",
  "OTZ",
]);

function isRelevantDocCookie(c) {
  if (!c || !c.name || !c.value) return false;
  if (DISALLOWED_COOKIE_NAMES.has(c.name)) return false;
  if (c.name.startsWith("__Host-GMAIL") || c.name.startsWith("GMAIL")) return false;
  if (c.name.startsWith("__Host-") && !c.name.includes("OSID") && !c.name.includes("SID")) return false;
  if (ALLOWED_COOKIE_NAMES.has(c.name)) return true;
  if (c.domain && c.domain.includes("docs.google.com")) return true;
  return false;
}

function hasCancellationContent(html) {
  if (!html) return false;
  return (
    html.includes("BCA Class Cancellation List") ||
    (html.includes("Cancellation") && /<table[^>]*>/i.test(html)) ||
    (html.includes("Cancellation List") && /<table[^>]*>/i.test(html)) ||
    (/<table[^>]*>/i.test(html) && /Teacher/i.test(html))
  );
}

/**
 * Silently opens an inactive background tab to load the document in Chrome's authenticated
 * context, extracts the rendered outerHTML, and immediately closes the tab.
 */
async function captureDocHtmlViaBackgroundTab(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let tabId = null;
    let pollInterval = null;
    let timeoutTimer = null;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (pollInterval) clearInterval(pollInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      if (tabId) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
    };

    const tryExtract = async () => {
      if (finished || !tabId) return;
      try {
        const injection = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        });
        const html = injection && injection[0] ? injection[0].result : null;
        if (html && hasCancellationContent(html)) {
          cleanup();
          resolve(html);
        }
      } catch (err) {
        // Tab might still be navigating or executing scripts
      }
    };

    const onUpdatedListener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        if (!pollInterval) {
          setTimeout(tryExtract, 500);
          pollInterval = setInterval(tryExtract, 500);
        }
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdatedListener);

    timeoutTimer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        cleanup();
        resolve(null);
      } else {
        tabId = tab.id;
      }
    });
  });
}

/**
 * Retrieves extension settings from chrome.storage.local with defaults.
 */
async function getConfig() {
  const defaults = {
    webAppUrl: "",
    docUrl: DEFAULT_DOC_URL,
    authUser: "kabsek30@bergen.org",
    secret: "",
    syncIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
    autoSync: true,
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

/**
 * Gathers relevant Google session cookies for the target Google Doc URL.
 * Combines URL-specific cookies with docs.google.com and google.com cookies,
 * filtering out foreign subdomain and account chooser cookies.
 */
async function getGoogleCookies(targetUrl) {
  const cookieMap = new Map();

  const addCookies = (list) => {
    if (!list) return;
    for (const c of list) {
      if (isRelevantDocCookie(c)) {
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

  const cookiesList = [];
  for (const [name, value] of cookieMap.entries()) {
    cookiesList.push({ name, value });
  }

  const names = cookiesList.map((c) => c.name);
  console.log(`Gathered ${cookiesList.length} relevant session cookie(s): ${names.join(", ")}`);
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

  let cleanDocUrl = (config.docUrl && config.docUrl.trim()) || DEFAULT_DOC_URL;

  // Clean published doc URL (remove broken authuser parameter that causes redirects on /pub)
  cleanDocUrl = cleanDocUrl.replace(/[?&]authuser=[^&]+/gi, "");
  if (!cleanDocUrl.includes("not_in_iframe=true")) {
    cleanDocUrl += (cleanDocUrl.includes("?") ? "&" : "?") + "not_in_iframe=true";
  }

  try {
    // 1. Gather all filtered Google session cookies (fast, ~10ms)
    const cookies = await getGoogleCookies(cleanDocUrl);
    const cookieString = cookies && cookies.length > 0 ? formatCookieHeader(cookies) : "";

    let docHtml = null;

    // 2. Fast check: Extract from any open Chrome tab containing the document (<50ms)
    try {
      const allTabs = await chrome.tabs.query({});
      const docTabs = allTabs.filter(
        (t) =>
          t.url &&
          (t.url.includes("docs.google.com/document/d/e/") ||
            t.url.includes("2PACX-1vRkhySmwAiTtY88tcshckpV4F0vRrULccaGrYl_Sf2ubWpyyXA4l8c-KAOuMzSwFe-qyAQhLqXzVsbA"))
      );

      if (docTabs && docTabs.length > 0) {
        console.log(`Found ${docTabs.length} open cancellation doc tab(s). Extracting rendered DOM...`);
        for (const tab of docTabs) {
          const injection = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML,
          });
          if (injection && injection[0] && injection[0].result) {
            const tabHtml = injection[0].result;
            if (hasCancellationContent(tabHtml)) {
              docHtml = tabHtml;
              console.log("Successfully extracted cancellation HTML from open Chrome tab!");
              break;
            }
          }
        }
      }
    } catch (tabErr) {
      console.warn("Could not extract from open tab:", tabErr);
    }

    // 3. Fallback: Rapid background tab capture (max 3.5s timeout)
    if (!docHtml) {
      try {
        console.log("Attempting fast background tab render & DOM capture for:", cleanDocUrl);
        docHtml = await captureDocHtmlViaBackgroundTab(cleanDocUrl, 3500);
        if (docHtml) {
          console.log("Background tab capture succeeded! Captured HTML length:", docHtml.length);
        }
      } catch (bgErr) {
        console.warn("Background tab capture error:", bgErr);
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
      authUser: (config.authUser && config.authUser.trim()) || undefined,
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
      const successMsg =
        resultJson.message ||
        (docHtml ? "Cancellation document and cookies synchronized successfully." : "Cookie synchronized successfully.");
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
        hasDirectHtml: !!docHtml,
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
