import Foundation

enum SmileBASICEdition: String, CaseIterable {
    case full, demo

    var saveCommands: [String] {
        self == .demo
            ? ["PRGEDIT 0", "SAVEV \"TXT:NS2\", PRGGET$()"]
            : ["SAVE \"NS2\""]
    }

    var loadCommand: String {
        self == .demo
            ? "PRGEDIT 0:LOADV \"TXT:NS2\" OUT C$:PRGSET C$"
            : "LOAD \"TXT:NS2\""
    }

    var commandArguments: [String] { self == .demo ? ["--demo"] : [] }

    var saveInstructions: String {
        self == .demo
            ? "The bootstrap has finished typing. Enter Direct mode and run these two commands, one at a time, to save the program from slot 0 as TXT:NS2. Return to the start screen after saving."
            : "The bootstrap has finished typing. Enter Direct mode, run the command below, and save NS2 in slot 0. Return to the start screen after saving."
    }

    var savedConfirmation: String {
        self == .demo
            ? "TXT:NS2 is saved using SAVEV and I have entered Direct mode"
            : "NS2 is saved in slot 0 and I have entered Direct mode"
    }
}
