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

// Reviewed public readiness/status literals, not credential values. Bind every
// allowed match to its exact file, whole immutable bytes and match digest.
// No file or token-family exclusions; all additional/changed matches fail.
const reviewedArtifactEnums = Object.freeze(
  [
    {
      file: "artifacts/google-live-acceptance/acceptance-stage0-v4-readiness-preflight-20261008.json",
      sha256:
        "7182b35dc9c4aed0c263eb372e91c0fe2b49cc7b5a74ca451dd0a481512b8295",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/build-stage0-T-renew-20261008T171901Z.mjs",
      sha256:
        "629ca3d2aa33195b5a3a9dc65e68c3e4a7a60ecefd845354fa57e19dc8150819",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/build-stage0-readiness-20261008.mjs",
      sha256:
        "647614dbb7a4c8eebc80caba2b4f7786f635ee3e3af5cedb32841996f0cc21be",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage0-readiness-20261008/harness/stage0-readiness.mjs",
      sha256:
        "f6092de3bc39b38c8114e4ee7ac5c6232f5bb73319cdc01005a88289922165f6",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage0-readiness-v2-20261008/harness/stage0-v2-readiness.mjs",
      sha256:
        "859a0e4b325c026295c462785a441dac5c51c595f75602ce06bb4f32e5c91cec",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage0-readiness-v3-20261008/harness/stage0-v3-readiness.mjs",
      sha256:
        "5c5f3512018435c6091fa5043dd5b582dfca0330684e2d6a4a81af5a10a86e6d",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage0-readiness-v4-20261008/harness/stage0-v4-readiness.mjs",
      sha256:
        "069c6b8b768c771c847fd989eec3be57620c48451aabda5c2ee882fbdc53ead7",
      matchSha256: [
        "0dbb1849f1e431feb40147f154510171dd74a5b5922b6c1a36b145b0d987ff4d",
        "bfe5b75cf0280d84e74e82a02de2cb755934eaa496737a774dcc976ec8efe6a5",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage01-parallel-recovery-stage0-checkpoint-20261008.json",
      sha256:
        "b7aee159d8b173e1da95b09e0f84ee46f0803610b12e4f7cbe3eb5c486f8c144",
      matchSha256: [
        "7e627b1cd68ac948fb096624dbc235484b3492ba486e3b113016a0717a98bde8",
      ],
    },
    {
      file: "artifacts/google-live-acceptance/stage1-final-live-acceptance-20261008T183050Z.json",
      sha256:
        "9e78af0eceba02c0187c1184bbc2c6e42e8c1e8bf02df8cd27d010ae2d6f2926",
      matchSha256: [
        "f262c6ed96f01bcb981c24c502b4f551f0221cde51f993a5b5a8c803175ad321",
        "776410f067abb4c95fad5c3bece69ed16d613a987e4fcafcf4fd0e97723b14d1",
      ],
    },
  ].map(Object.freeze),
);

export function matchesReviewedArtifactEnum(file, content, value, finding) {
  return (
    file === finding.file &&
    createHash("sha256").update(content).digest("hex") === finding.sha256 &&
    finding.matchSha256.includes(
      createHash("sha256").update(value).digest("hex"),
    )
  );
}

export function hasForbiddenValue(file, content, pattern) {
  const matches = content.matchAll(new RegExp(pattern.source, "g"));
  return [...matches].some(
    (match) =>
      !reviewedFindings.some((finding) =>
        matchesReviewedFinding(file, content, match[0], finding),
      ) &&
      !reviewedArtifactEnums.some((finding) =>
        matchesReviewedArtifactEnum(file, content, match[0], finding),
      ),
  );
}
