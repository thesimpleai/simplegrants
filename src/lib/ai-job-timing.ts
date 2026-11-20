const standardTiming = {
  workerMs: 120_000,
  modelMs: 90_000,
  statusMs: 135_000,
  browserMs: 150_000,
};

const profileVerificationTiming = {
  workerMs: 210_000,
  modelMs: 120_000,
  statusMs: 225_000,
  browserMs: 240_000,
};

export function aiJobTiming(profileVerification: boolean) {
  return profileVerification ? profileVerificationTiming : standardTiming;
}

export function isProfileVerification(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    "action" in payload &&
    payload.action === "profile" &&
    "profileStage" in payload &&
    payload.profileStage === "verify"
  );
}
