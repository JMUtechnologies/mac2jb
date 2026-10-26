import Foundation

@main struct SmileBASICEditionTests {
    static func main() throws {
        let sender = URL(fileURLWithPath: CommandLine.arguments[1])
        precondition(SmileBASICEdition.full.saveCommands == ["SAVE \"NS2\""])
        precondition(SmileBASICEdition.demo.saveCommands == ["PRGEDIT 0", "SAVEV \"TXT:NS2\", PRGGET$()"])
        precondition(SmileBASICEdition.demo.savedConfirmation.contains("SAVEV"))
        precondition(!SmileBASICEdition.full.savedConfirmation.contains("SAVEV"))
        for edition in SmileBASICEdition.allCases {
            let task = Process(), output = Pipe()
            task.executableURL = sender
            task.arguments = ["--dry-run"] + edition.commandArguments
            task.standardOutput = output; task.standardError = output
            task.standardInput = FileHandle.nullDevice
            try task.run()
            let result = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            task.waitUntilExit()
            precondition(task.terminationStatus == 0, result)
            precondition(result.contains("1: \(edition.loadCommand) [Enter]"), result)
            precondition(result.contains("2: RUN [Enter]"), result)
            precondition(result.contains("3: REMOVE NSR,&H60000000,&H3FFFFFFF [Enter]"), result)
            precondition(result.contains("4: V=START("), result)
        }
        print("Full/demo save prompts match the actual native sender's selected load command; no USB input sent.")
    }
}
