"""Pure opt-in V2 phase policy for the 180-second replacement watchdog."""

from collections import deque

from production_only_guard_policy import LIMITS

PROFILE = "STARTUP_PRESSURE_AWARE_V2"
MAX_OLD_STOP_SWAP_IN_PAGES = 1024
MAX_OLD_STOP_MAJOR_FAULTS = 512
MAX_OLD_STOP_EVENT_SAMPLES = 3
MAX_OLD_STOP_EVENT_SECONDS = 5.0
MAX_OLD_STOP_PSI_SOME = 0.1
PHASES = ("before-stop", "stopping-old", "old-stopped",
          "starting-candidate", "candidate-running")


class State:
    def __init__(self, first, *, allow_old_stop_swapin=True):
        self.allow_old_stop_swapin = allow_old_stop_swapin
        self.first = first
        self.previous = first
        self.window = deque([(first["t"], first)])
        self.old_event_indices = []
        self.out_event_indices = []
        self.old_event_end_t = None
        self.old_event_start_t = None
        self.old_stable_samples = 0
        self.old_cleared = False
        self.post_old_baseline = None
        self.candidate_baseline = None
        self.index = 0
        self.warnings = []
        self.peak60 = {key: 0 for key in ("pswpout", "pswpin", "pgmajfault")}

    def update(self, sample, phase):
        if phase not in PHASES:
            return ["phase_missing_or_invalid"]
        self.index += 1
        previous = self.previous
        self.previous = sample
        self.window.append((sample["t"], sample))
        while len(self.window) > 1 and self.window[1][0] <= sample["t"] - 60:
            self.window.popleft()
        base60 = self.window[0][1]
        for key in self.peak60:
            self.peak60[key] = max(self.peak60[key], sample[key] - base60[key])
        reasons = []
        if sample["t"] <= previous["t"] or sample["t"] - previous["t"] > LIMITS["max_sample_gap_s"]:
            reasons.append("sample_gap_or_clock_error")
        for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill", "pgscan_direct"):
            if key not in sample or key not in previous:
                reasons.append("evidence_missing:" + key)
            elif sample[key] < previous[key]:
                reasons.append("counter_reset:" + key)
        if reasons:
            return reasons
        if sample["mem_available_kib"] < LIMITS["mem_available_kib"]:
            reasons.append("mem_floor")
        if sample["swap_free_kib"] < LIMITS["swap_free_kib"]:
            reasons.append("swap_floor")
        if sample["disk_free_mib"] < LIMITS["disk_free_mib"]:
            reasons.append("disk_floor")
        if sample["psi_full_avg10"] >= LIMITS["psi_full_avg10"]:
            reasons.append("psi_full")
        if sample["psi_some_avg10"] >= LIMITS["psi_some_avg10"]:
            reasons.append("psi_some")
        if sample["oom_kill"] != self.first["oom_kill"]:
            reasons.append("oom")
        if sample["pgscan_direct"] != self.first["pgscan_direct"]:
            reasons.append("direct_reclaim")
        if sample["pswpout"] - self.first["pswpout"] > LIMITS["swap_out_600s"] or \
                sample["pswpout"] - base60["pswpout"] > LIMITS["swap_out_60s"]:
            reasons.append("swap_out")
        if sample["pswpout"] > previous["pswpout"] and sample["pswpin"] > previous["pswpin"]:
            reasons.append("simultaneous_swap_in_out")
        if sample["pswpout"] > previous["pswpout"]:
            self.out_event_indices.append(self.index)
        if len(self.out_event_indices) > 3 or any(
                b != a + 1 for a, b in zip(self.out_event_indices,
                                            self.out_event_indices[1:])):
            reasons.append("sustained_or_repeated_swap_out")
        if self.warnings and sample["pswpout"] > self.first["pswpout"]:
            reasons.append("swap_out_after_old_stop_warning")
        if self.warnings and (sample["psi_full_avg10"] > 0 or
                              sample["psi_some_avg10"] > MAX_OLD_STOP_PSI_SOME):
            reasons.append("psi_after_old_stop_warning")
        if reasons:
            return reasons

        old_window = phase in ("stopping-old", "old-stopped") and not self.old_cleared
        if old_window:
            if not self.allow_old_stop_swapin:
                if sample["pswpin"] - self.first["pswpin"] > LIMITS["swap_in_600s"] or \
                        sample["pswpin"] - base60["pswpin"] > LIMITS["swap_in_60s"]:
                    reasons.append("swap_in")
                if sample["pgmajfault"] - self.first["pgmajfault"] > LIMITS["major_faults_600s"] or \
                        sample["pgmajfault"] - base60["pgmajfault"] > LIMITS["major_faults_60s"]:
                    reasons.append("major_faults")
                if phase == "old-stopped" and not reasons:
                    self.old_cleared = True
                    self.post_old_baseline = sample
                return reasons
            if sample["pswpin"] > previous["pswpin"]:
                self.old_event_indices.append(self.index)
                if self.old_event_start_t is None:
                    self.old_event_start_t = sample["t"]
                self.old_event_end_t = sample["t"]
                self.old_stable_samples = 0
            elif phase == "old-stopped" and self.old_event_indices:
                self.old_stable_samples += 1
            if (len(self.old_event_indices) > MAX_OLD_STOP_EVENT_SAMPLES or
                    any(b != a + 1 for a, b in zip(self.old_event_indices,
                                                    self.old_event_indices[1:])) or
                    (self.old_event_start_t is not None and
                     self.old_event_end_t - self.old_event_start_t > MAX_OLD_STOP_EVENT_SECONDS)):
                reasons.append("old_stop_swap_in_not_isolated")
            if self.old_event_indices and sample["pswpout"] > self.first["pswpout"]:
                reasons.append("swap_out_during_old_stop_swap_in")
            if self.old_event_indices and (sample["psi_full_avg10"] > 0 or
                                           sample["psi_some_avg10"] > MAX_OLD_STOP_PSI_SOME):
                reasons.append("psi_during_old_stop_swap_in")
            if sample["pswpin"] - self.first["pswpin"] > MAX_OLD_STOP_SWAP_IN_PAGES:
                reasons.append("old_stop_swap_in_ceiling")
            if sample["pgmajfault"] - self.first["pgmajfault"] > MAX_OLD_STOP_MAJOR_FAULTS:
                reasons.append("old_stop_major_faults_ceiling")
            if not self.old_event_indices and (
                    sample["pgmajfault"] - self.first["pgmajfault"] > LIMITS["major_faults_600s"] or
                    sample["pgmajfault"] - base60["pgmajfault"] > LIMITS["major_faults_60s"]):
                reasons.append("major_faults_without_old_stop_swap_in")
            if (sample["pswpin"] - self.first["pswpin"] <= LIMITS["swap_in_600s"] and
                    (sample["pgmajfault"] - self.first["pgmajfault"] > LIMITS["major_faults_600s"] or
                     sample["pgmajfault"] - base60["pgmajfault"] > LIMITS["major_faults_60s"])):
                reasons.append("major_faults_without_swap_in_trigger")
            if phase == "old-stopped" and (not self.old_event_indices or
                                           self.old_stable_samples >= 2):
                self.old_cleared = True
                self.post_old_baseline = sample
                if self.old_event_indices:
                    self.warnings.append("isolated_swap_in_during_old_web_stop")
            return reasons

        if phase in ("starting-candidate", "candidate-running"):
            if not self.old_cleared:
                return ["old_stop_evidence_missing"]
            if self.candidate_baseline is None:
                if phase != "starting-candidate":
                    return ["candidate_phase_unarmed"]
                if base60["t"] < self.post_old_baseline["t"]:
                    base60 = self.post_old_baseline
                # The fresh baseline is acknowledged before Compose, but a
                # burst between old-stop clearance and arming is still hard.
                if (sample["pswpin"] - self.post_old_baseline["pswpin"] > LIMITS["swap_in_600s"] or
                        sample["pswpin"] - base60["pswpin"] > LIMITS["swap_in_60s"]):
                    reasons.append("swap_in_before_candidate_armed")
                if (sample["pgmajfault"] - self.post_old_baseline["pgmajfault"] > LIMITS["major_faults_600s"] or
                        sample["pgmajfault"] - base60["pgmajfault"] > LIMITS["major_faults_60s"]):
                    reasons.append("major_faults_before_candidate_armed")
                if reasons:
                    return reasons
                self.candidate_baseline = sample
                return reasons
            baseline = self.candidate_baseline
        elif self.old_cleared and phase == "old-stopped":
            baseline = self.post_old_baseline
        else:
            baseline = self.first
        if base60["t"] < baseline["t"]:
            base60 = baseline
        if sample["pswpin"] - baseline["pswpin"] > LIMITS["swap_in_600s"] or \
                sample["pswpin"] - base60["pswpin"] > LIMITS["swap_in_60s"]:
            reasons.append("swap_in")
        if sample["pgmajfault"] - baseline["pgmajfault"] > LIMITS["major_faults_600s"] or \
                sample["pgmajfault"] - base60["pgmajfault"] > LIMITS["major_faults_60s"]:
            reasons.append("major_faults")
        return reasons
