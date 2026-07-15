/**
 * Snapshot of well-known tracking/analytics domains (base domains).
 * Sourced from public blocklists (EasyPrivacy / DDG Tracker Radar categories).
 * Update with each release.
 */
export const TRACKER_DOMAINS = new Set<string>([
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "facebook.net",
  "connect.facebook.net",
  "hotjar.com",
  "mixpanel.com",
  "segment.com",
  "segment.io",
  "amplitude.com",
  "fullstory.com",
  "mouseflow.com",
  "clarity.ms",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",
  "bugsnag.com",
  "datadoghq.com",
  "branch.io",
  "adjust.com",
  "appsflyer.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "scorecardresearch.com",
  "quantserve.com",
  "chartbeat.com",
  "parsely.com",
  "optimizely.com",
  "crazyegg.com",
  "heap.io",
  "heapanalytics.com",
  "kissmetrics.com",
  "matomo.cloud",
  "plausible.io",
  "yandex.ru",
  "mc.yandex.ru",
  "vk.com",
  "tiktok.com",
  "analytics.tiktok.com",
  "snapchat.com",
  "sc-static.net",
  "pinterest.com",
  "ct.pinterest.com",
  "linkedin.com",
  "ads.linkedin.com",
  "bing.com",
  "bat.bing.com",
  "adsrvr.org",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "adnxs.com",
  "amazon-adsystem.com",
  "moatads.com",
  "onetrust.com",
  "cookielaw.org",
  "braze.com",
  "iterable.com",
  "klaviyo.com",
  "intercom.io",
  "drift.com",
  "hs-analytics.net",
  "hubspot.com",
]);

/** Headers that commonly carry identifiers / enable tracking. */
export const TRACKING_HEADERS: Record<string, string> = {
  "x-client-data": "Chrome-specific header sent to Google properties; carries an install-specific identifier.",
  "x-fb-debug": "Facebook debugging/tracking header.",
  "x-requested-id": "Request correlation id — fine server-side, but can be used to stitch sessions.",
};

/** High-entropy client hints that enable fingerprinting when requested together. */
export const FINGERPRINT_CLIENT_HINTS = [
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-arch",
  "sec-ch-ua-model",
  "sec-ch-ua-bitness",
  "sec-ch-ua-platform-version",
  "sec-ch-device-memory",
  "sec-ch-dpr",
];

/** Query/body keys that suggest sensitive data in transit. */
export const SENSITIVE_PARAM_RE =
  /^(password|passwd|pwd|secret|token|access_token|auth|authorization|api[_-]?key|apikey|session|sessionid|ssn|credit_card|card_number)$/i;

/** Secret-looking values (JWTs, cloud keys) for URL/source scanning. */
export const SECRET_VALUE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Stripe-style secret key", re: /sk_(live|test)_[0-9a-zA-Z]{20,}/ },
  { name: "Generic API key assignment", re: /(api[_-]?key|secret|private[_-]?key)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i },
  { name: "Bearer token in text", re: /Bearer\s+[A-Za-z0-9_\-.=]{20,}/ },
];
