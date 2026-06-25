const USER_AGENT = "npx-vibe/1.2.0 (+https://www.npmjs.com/package/npx-vibe)";

export async function buildPackageProfile(packument, manifest, version, options = {}) {
  const repository = normalizeRepository(manifest.repository ?? packument.repository);
  const github = repository.github
    ? await fetchGitHubProfile(repository.github, options).catch((error) => ({ error: error.message }))
    : null;

  return {
    description: manifest.description ?? packument.description ?? null,
    license: manifest.license ?? packument.license ?? null,
    homepage: manifest.homepage ?? packument.homepage ?? null,
    bugs: normalizeBugs(manifest.bugs ?? packument.bugs),
    repository,
    author: normalizePerson(manifest.author ?? packument.author),
    publisher: normalizePerson(manifest._npmUser),
    maintainers: Array.isArray(packument.maintainers) ? packument.maintainers.map(normalizePerson).filter(Boolean).slice(0, 12) : [],
    maintainersCount: Array.isArray(packument.maintainers) ? packument.maintainers.length : null,
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords.slice(0, 12) : [],
    distTags: packument["dist-tags"] ?? {},
    latestVersion: packument["dist-tags"]?.latest ?? null,
    deprecated: manifest.deprecated ?? null,
    npm: {
      createdAt: packument.time?.created ?? null,
      modifiedAt: packument.time?.modified ?? null,
      versionPublishedAt: packument.time?.[version] ?? null,
    },
    dist: {
      unpackedSize: manifest.dist?.unpackedSize ?? null,
      fileCount: manifest.dist?.fileCount ?? null,
      tarball: manifest.dist?.tarball ?? null,
    },
    github,
  };
}

export function normalizeRepository(repository) {
  if (!repository) {
    return { type: null, url: null, display: null, github: null };
  }

  const rawUrl = typeof repository === "string" ? repository : repository.url;
  if (!rawUrl) {
    return { type: repository.type ?? null, url: null, display: null, github: null };
  }

  const url = cleanRepositoryUrl(rawUrl);
  const github = extractGitHubSlug(url);
  return {
    type: typeof repository === "object" ? repository.type ?? null : null,
    url,
    display: github ? `github.com/${github}` : url,
    github,
  };
}

async function fetchGitHubProfile(slug, options = {}) {
  const repo = await fetchGitHubJson(`https://api.github.com/repos/${slug}`, options);
  const commits = await fetchGitHubJson(`https://api.github.com/repos/${slug}/commits?per_page=1`, options).catch(() => []);
  const latestCommit = Array.isArray(commits) && commits[0] ? commits[0] : null;

  return {
    slug,
    url: repo.html_url ?? `https://github.com/${slug}`,
    description: repo.description ?? null,
    defaultBranch: repo.default_branch ?? null,
    stars: repo.stargazers_count ?? null,
    forks: repo.forks_count ?? null,
    openIssues: repo.open_issues_count ?? null,
    archived: Boolean(repo.archived),
    disabled: Boolean(repo.disabled),
    pushedAt: repo.pushed_at ?? null,
    updatedAt: repo.updated_at ?? null,
    latestCommit: latestCommit
      ? {
          sha: latestCommit.sha?.slice(0, 12) ?? null,
          date: latestCommit.commit?.committer?.date ?? latestCommit.commit?.author?.date ?? null,
          author: latestCommit.commit?.author?.name ?? null,
          message: firstLine(latestCommit.commit?.message),
          url: latestCommit.html_url ?? null,
        }
      : null,
  };
}

async function fetchGitHubJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 15_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status} ${response.statusText}).`);
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms while fetching GitHub metadata.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePerson(person) {
  if (!person) {
    return null;
  }
  if (typeof person === "string") {
    return { name: person, email: null, url: null };
  }
  return {
    name: person.name ?? null,
    email: person.email ?? null,
    url: person.url ?? null,
  };
}

function normalizeBugs(bugs) {
  if (!bugs) {
    return null;
  }
  if (typeof bugs === "string") {
    return { url: bugs, email: null };
  }
  return {
    url: bugs.url ?? null,
    email: bugs.email ?? null,
  };
}

function cleanRepositoryUrl(url) {
  return String(url)
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//i, "https://github.com/")
    .replace(/^github:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git(?:#.*)?$/i, "")
    .replace(/#.*$/, "");
}

function extractGitHubSlug(url) {
  const match = String(url).match(/github\.com[/:]([^/\s#]+)\/([^/\s#]+)(?:\/|$)?/i);
  if (!match) {
    return null;
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  return `${owner}/${repo}`;
}

function firstLine(value) {
  return value ? String(value).split(/\r?\n/)[0].slice(0, 160) : null;
}
