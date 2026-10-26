import Foundation

@main struct SessionRecoveryTests {
    static func main() {
        var passed = 0
        func check(_ condition: Bool, _ name: String) {
            guard condition else { fatalError("FAIL: " + name) }
            passed += 1
            print("PASS " + name)
        }
        let upstream = "The run stopped. Keep the runs folder and restart the console before trying again."
        for phase in [SessionPhase.hostStarting, .commands, .waitingForConsole] {
            check(SessionRecovery.message(upstream, interruptedPhase: phase) == upstream,
                  "\(phase): upstream restart instruction is not repeated")
            let cancelled = SessionRecovery.message("Session stopped.", interruptedPhase: phase)
            check(cancelled.components(separatedBy: "Restart the console").count == 2 &&
                  !cancelled.contains("partial bootstrap"), "\(phase): cancellation has one restart and no bootstrap advice")
            let failed = SessionRecovery.message("The USB transfer stopped unexpectedly.", interruptedPhase: phase)
            check(failed.contains("Restart the console") && !failed.contains("partial bootstrap"),
                  "\(phase): failure recovery applies to post-bootstrap")
        }
        for message in ["The bootstrap transfer stopped.", "Session stopped."] {
            let recovery = SessionRecovery.message(message, interruptedPhase: .bootstrap)
            check(recovery.contains("Clear any partial bootstrap") && !recovery.contains("Restart the console"),
                  "bootstrap failure/cancellation asks to clear partial bootstrap")
            check(SessionRecovery.message(recovery, interruptedPhase: .bootstrap) == recovery,
                  "bootstrap guidance is not repeated")
        }
        for phase in [SessionPhase.preparing, .ready, .awaitingSave, .verified, .failed, .cancelled] {
            check(SessionRecovery.message("Session stopped.", interruptedPhase: phase) == "Session stopped.",
                  "\(phase): no partial-bootstrap or post-bootstrap instruction")
        }
        check(SessionRecovery.message("Reboot your Switch 2 before retrying.", interruptedPhase: .commands) ==
              "Reboot your Switch 2 before retrying.", "alternate console-restart wording is preserved")
        check(SessionRecovery.message("restart the console before retrying.", interruptedPhase: .waitingForConsole) ==
              "restart the console before retrying.", "restart detection ignores capitalization")
        for phase in [SessionPhase.rpcHeld, .rpcFinishing, .dumpingFirmware,
                      .launchingHomebrew, .homebrewRunning, .homebrewStopped] {
            let stopped = SessionRecovery.message("Session stopped.", interruptedPhase: phase)
            check(stopped.components(separatedBy: "Restart the console").count == 2 &&
                  stopped.contains("after the host has stopped") && !stopped.contains("partial bootstrap"),
                  "\(phase): live-session recovery waits for the host and has one restart")
            check(SessionRecovery.message(stopped, interruptedPhase: phase) == stopped,
                  "\(phase): repeated recovery does not duplicate instructions")
            let provided = SessionRecovery.message(upstream, interruptedPhase: phase)
            check(provided.lowercased().components(separatedBy: "restart the console").count == 2,
                  "\(phase): existing restart guidance is retained once")
        }
        let dump = SessionRecovery.message("The dump stopped.", interruptedPhase: .dumpingFirmware)
        check(dump.contains("partial system-code dump") && dump.contains("logs and dump folder"),
              "interrupted dump retains partial acquisition and logs")
        for phase in [SessionPhase.launchingHomebrew, .homebrewRunning] {
            let homebrew = SessionRecovery.message("Stremio stopped.", interruptedPhase: phase)
            check(homebrew.contains("homebrew logs") && !homebrew.contains("HBLauncher"),
                  "\(phase): homebrew recovery applies to the current app")
        }
        print("\(passed) session recovery checks passed; no hardware used.")
    }
}
