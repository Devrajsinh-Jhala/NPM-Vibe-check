export function decideVerdict(analysis, aiReview, options = {}) {
  const cautionScore = Number(options.cautionScore ?? 40);
  const blockScore = Number(options.blockScore ?? 70);
  let score = analysis.staticScore;
  const reasons = [];

  if (analysis.findings.some((finding) => finding.severity === "critical")) {
    score = 100;
    reasons.push("Critical deterministic finding.");
  }

  if (aiReview?.status === "ok") {
    const aiScore = aiReview.evidenceSufficientForBlock === false
      ? Math.min(Number(aiReview.riskScore ?? 0), cautionScore + 10)
      : Number(aiReview.riskScore ?? 0);
    score = Math.max(score, aiScore);
    if (aiReview.confidence === "low" && analysis.needsAi) {
      score = Math.max(score, cautionScore + 5);
      reasons.push("AI confidence was low.");
    }
    if (aiReview.recommendedVerdict === "block") {
      if (aiReview.evidenceSufficientForBlock) {
        score = Math.max(score, blockScore);
        reasons.push("AI recommended blocking with source-backed high-risk evidence.");
      } else {
        score = Math.max(score, cautionScore);
        reasons.push("AI block recommendation lacked source-backed high-risk evidence.");
      }
    } else if (aiReview.recommendedVerdict === "caution") {
      score = Math.max(score, cautionScore);
      reasons.push("AI recommended caution.");
    }
  } else if (aiReview?.status === "invalid") {
    score = Math.max(score, cautionScore + 10);
    reasons.push("AI returned invalid review JSON.");
  }

  if (analysis.findings.some((finding) => finding.code === "ai_unavailable")) {
    reasons.push("AI review was unavailable for a package that triggered review.");
  }

  let verdict = "proceed";
  if (score >= blockScore || analysis.findings.some((finding) => finding.severity === "critical")) {
    verdict = "block";
  } else if (score >= cautionScore || analysis.findings.some((finding) => finding.severity === "medium" || finding.severity === "high")) {
    verdict = "caution";
  }

  return {
    verdict,
    score: Math.round(Math.max(0, Math.min(100, score))),
    reasons,
  };
}

export function checkExitCode(verdict) {
  if (verdict === "proceed") {
    return 0;
  }
  if (verdict === "caution") {
    return 2;
  }
  if (verdict === "block") {
    return 3;
  }
  return 1;
}
