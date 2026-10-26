import Foundation

@main struct BootstrapProgressTests {
    static func main() {
        let start = BootstrapLineProgress(type: "line-start", line: 212, completed: 211, total: 229)!
        precondition(start.label == "Typing line 212 of 229")
        precondition(start.completed == 211 && start.fraction == 211.0 / 229)
        let complete = BootstrapLineProgress(type: "line-complete", line: 212, completed: 212, total: 229)!
        precondition(complete.label == "212 of 229 lines sent")
        precondition(complete.fraction == 212.0 / 229)
        let next = BootstrapLineProgress(type: "line-start", line: 213, completed: 212, total: 229)!
        precondition(next.label == "Typing line 213 of 229" && next.fraction == complete.fraction)
        let first = BootstrapLineProgress(type: "line-start", line: 1, completed: 0, total: 229)!
        precondition(first.label == "Typing line 1 of 229" && first.fraction == 0)
        let legacy = BootstrapLineProgress(type: "progress", line: nil, completed: 211, total: 229)!
        precondition(legacy.label == start.label && legacy.fraction == start.fraction)
        let final = BootstrapLineProgress(type: "line-complete", line: 229, completed: 229, total: 229)!
        precondition(final.label == "229 of 229 lines sent" && final.fraction == 1)
        let legacyFinal = BootstrapLineProgress(type: "progress", line: nil, completed: 229, total: 229)!
        precondition(legacyFinal.label == final.label)
        for values: (String, Int?, Double?, Double?) in [
            ("line-start", 212, 212, 229), ("line-complete", 212, 211, 229),
            ("line-start", 0, 0, 229), ("line-start", 230, 229, 229),
            ("line-start", nil, 0, 229), ("line-start", 1, 0, 0),
            ("progress", nil, 230, 229), ("progress", nil, 1.5, 229),
            ("progress", nil, .infinity, 229), ("progress", nil, 1, .nan)
        ] {
            precondition(BootstrapLineProgress(type: values.0, line: values.1, completed: values.2, total: values.3) == nil)
        }
        print("Bootstrap progress labels distinguish the current line from completed lines; invalid counters are rejected.")
    }
}
