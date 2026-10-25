import Foundation

enum SessionPhase: String {
    case preparing, ready, bootstrap, awaitingSave, hostStarting, commands
    case waitingForConsole, verified, failed, cancelled
}

enum SessionRecovery {
    // Use the phase that stopped, before switching to failed/cancelled. The
    // mode picker describes the next run and cannot identify this failure.
    static func message(_ message: String, interruptedPhase: SessionPhase) -> String {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        switch interruptedPhase {
        case .bootstrap:
            guard message.range(of: "partial bootstrap", options: .caseInsensitive) == nil else { return message }
            return append("Clear any partial bootstrap before typing again.", to: message)
        case .hostStarting, .commands, .waitingForConsole:
            let restart = #"(?i)\b(?:restart|reboot)\s+(?:(?:the|your)\s+)?(?:console|switch(?:\s+2)?)\b"#
            guard message.range(of: restart, options: .regularExpression) == nil else { return message }
            return append("Restart the console before another post-bootstrap attempt.", to: message)
        default:
            return message
        }
    }

    private static func append(_ instruction: String, to message: String) -> String {
        message.isEmpty ? instruction : message + " " + instruction
    }
}
