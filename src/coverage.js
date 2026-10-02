// Coverage counts reviewed subjects, not every source file in their tarballs.
// Source inspection is deliberately bounded and remains described in stats.
export function reviewCoverage({ scope, requested, scanned, skipped = 0, failed = 0, reasons = [] }) {
  return {
    scope,
    complete: skipped === 0 && failed === 0 && scanned === requested,
    requested,
    scanned,
    skipped,
    failed,
    reasons: [...new Set(reasons)],
  };
}

export function reportCoverage(report, kind) {
  if (report?.coverage) return report.coverage;
  if (kind === "project-scan") {
    return reviewCoverage({
      scope: report?.project?.transitive ? "dependency-tree" : "direct-dependencies",
      requested: report?.summary?.discovered ?? 0,
      scanned: report?.summary?.scanned ?? 0,
      skipped: report?.summary?.skipped ?? 0,
      failed: report?.errors?.length ?? 0,
      reasons: [...(report?.skipped ?? []).map((entry) => entry.reason),
        ...(report?.errors ?? []).map((entry) => entry.message)],
    });
  }
  if (kind === "script-approvals") {
    return reviewCoverage({
      scope: "pending-install-scripts",
      requested: (report?.summary?.reviewed ?? 0) + (report?.errors?.length ?? 0),
      scanned: report?.summary?.reviewed ?? 0,
      failed: report?.errors?.length ?? 0,
      reasons: (report?.errors ?? []).map((entry) => entry.message),
    });
  }
  return reviewCoverage({ scope: "package", requested: 1, scanned: report ? 1 : 0 });
}
