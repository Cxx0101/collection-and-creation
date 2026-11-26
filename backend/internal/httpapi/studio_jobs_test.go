package httpapi

import "testing"

func TestCanDeleteStudioJobOnlyAllowsTerminalJobs(t *testing.T) {
	for _, status := range []string{"succeeded", "failed", "cancelled"} {
		if !canDeleteStudioJob(status) {
			t.Fatalf("terminal job %q should be deletable", status)
		}
	}
	for _, status := range []string{"queued", "running", "waiting_for_user", ""} {
		if canDeleteStudioJob(status) {
			t.Fatalf("non-terminal job %q should not be deletable", status)
		}
	}
}
