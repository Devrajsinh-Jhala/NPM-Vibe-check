const demos = {
  proceed: `$ npx npx-vibe --check is-number
✓ npx-vibe: Proceed  risk 0/100
is-number@7.0.0
Returns true if a number or string value is a finite number.

NPM updated: 2023-05-26  Version published: 2018-07-04
License: MIT  Maintainers: 3  Publisher: jonschlinkert
Repository: github.com/jonschlinkert/is-number
GitHub: 284 stars  Last commit: 98e8ff1da1a8
Downloads: 172,392,690/week
Install hooks: none
AI review: skipped

Action: package may be executed.`,
  caution: `$ npx npx-vibe --check esbuild
! npx-vibe: Caution  risk 46/100
esbuild@0.28.1
An extremely fast JavaScript and CSS bundler and minifier.

NPM updated: 2026-06-11  Version published: 2026-06-11
License: MIT  Maintainers: 1  Publisher: GitHub Actions
Repository: github.com/evanw/esbuild
GitHub: 39,955 stars  Last commit: 6ff1d8b0d8c1
Downloads: 244,263,932/week
Install hooks: postinstall
AI review: unavailable

Findings:
- MEDIUM lifecycle_hook in package.json
- MEDIUM network_and_shell in install.js

Action: review recommended before execution.`,
  block: `$ npx npx-vibe sketchy-helper
✕ npx-vibe: Block  risk 92/100
sketchy-helper@0.0.3
Fresh package with install-time credential access.

NPM updated: today  Version published: today
License: unknown  Maintainers: 1  Publisher: new-user
Repository: unknown
Downloads: 12/week
Install hooks: preinstall, postinstall
AI review: online model (high confidence)

Findings:
- CRITICAL possible_secret_exfiltration in setup.js
- CRITICAL download_and_execute in postinstall.js

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

const copyButton = document.querySelector("[data-copy]");
copyButton?.addEventListener("click", async () => {
  const text = copyButton.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1300);
  } catch {
    copyButton.textContent = "Copy failed";
    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1300);
  }
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