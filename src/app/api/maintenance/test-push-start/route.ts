import { POST as sendTeamTestPush } from "../test-push/route";

// Backward-compatible alias for older clients that still call /api/maintenance/test-push-start.
export const POST = sendTeamTestPush;
