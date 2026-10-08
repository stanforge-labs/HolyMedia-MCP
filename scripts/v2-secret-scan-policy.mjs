import { createHash } from "node:crypto";

// One reviewed public enum, pinned to the entire immutable historical evidence.
// This is not a path exclusion: every match is checked, and changed bytes fail.
const reviewedFindings = Object.freeze([
  Object.freeze({
    file: "artifacts/google-live-acceptance/stage1-completion-checkpoint-20261008-e-created-members-awaiting-approval.json",
    sha256: "a5933732863e3767216e5fff45bdb9b69c24ca028fc45d21c5be5f4ed46063dc",
    value: "EATE_PASS_" + "WAITING_FOR_MEMBERS_APPROVAL",
    status: "CREATE_PASS_" + "WAITING_FOR_MEMBERS_APPROVAL",
  }),
]);

export function matchesReviewedFinding(file, content, value, finding) {
  if (
    file !== finding.file ||
    value !== finding.value ||
    createHash("sha256").update(content).digest("hex") !== finding.sha256
  )
    return false;
  try {
    return JSON.parse(content).acceptance?.E?.status === finding.status;
  } catch {
    return false;
  }
}

export function hasForbiddenValue(file, content, pattern) {
  const matches = content.matchAll(new RegExp(pattern.source, "g"));
  return [...matches].some(
    (match) =>
      !reviewedFindings.some((finding) =>
        matchesReviewedFinding(file, content, match[0], finding),
      ),
  );
}
