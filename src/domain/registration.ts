export interface ManualOfficialPunchConfirmationContext {
  automatic: boolean;
  dailyPunchCount: number;
}

export function manualOfficialPunchRequiresConfirmation({
  automatic,
  dailyPunchCount,
}: ManualOfficialPunchConfirmationContext): boolean {
  return !automatic && dailyPunchCount > 0;
}
