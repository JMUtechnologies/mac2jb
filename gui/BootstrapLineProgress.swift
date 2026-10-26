import Foundation

// Current source line and completed source lines are distinct. Neither reports
// the target editor's cursor position or confirms that it accepted the input.
struct BootstrapLineProgress {
    let completed: Int
    let total: Int
    let label: String
    var fraction: Double { Double(completed) / Double(total) }

    init?(type: String, line: Int?, completed: Double?, total: Double?) {
        guard let completed, let total, completed.isFinite, total.isFinite,
              let count = Int(exactly: completed), let limit = Int(exactly: total),
              limit > 0, count >= 0, count <= limit else { return nil }
        switch type {
        case "line-start", "line-complete":
            guard let line, line >= 1, line <= limit,
                  count == line - (type == "line-start" ? 1 : 0) else { return nil }
            label = type == "line-start" ? "Typing line \(line) of \(limit)" : "\(count) of \(limit) lines sent"
        case "progress":
            // Compatibility with older senders that report only completed lines.
            label = count < limit ? "Typing line \(count + 1) of \(limit)" : "\(count) of \(limit) lines sent"
        default: return nil
        }
        self.completed = count
        self.total = limit
    }
}
