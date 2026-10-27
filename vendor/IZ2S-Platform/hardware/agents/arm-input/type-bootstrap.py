#!/usr/bin/env python3
"""US-layout USB keyboard sender. Default is preview; --send is explicit."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import sys
import time

SHIFT = 0x02
CTRL = 0x01
KEYS = {ch: (0, 4 + i) for i, ch in enumerate('abcdefghijklmnopqrstuvwxyz')}
KEYS.update({ch.upper(): (SHIFT, 4 + i) for i, ch in enumerate('abcdefghijklmnopqrstuvwxyz')})
KEYS.update({ch: (0, 30 + i) for i, ch in enumerate('1234567890')})
KEYS.update({ch: (SHIFT, 30 + i) for i, ch in enumerate('!@#$%^&*()')})
for plain, shifted, code in [('-', '_', 45), ('=', '+', 46), ('[', '{', 47),
                            (']', '}', 48), ('\\', '|', 49), (';', ':', 51),
                            ("'", '"', 52), ('`', '~', 53), (',', '<', 54),
                            ('.', '>', 55), ('/', '?', 56)]:
    KEYS[plain] = (0, code)
    KEYS[shifted] = (SHIFT, code)
KEYS.update({' ': (0, 44), '\n': (0, 40), '\t': (0, 43)})
SPECIAL = {'enter': 40, 'escape': 41, 'backspace': 42, 'capslock': 57, 'f4': 61, 'f7': 64, 'f8': 65,
           'home': 74, 'delete': 76, 'end': 77, 'left': 80, 'right': 79}
RELEASE = bytes(8)


class Keyboard:
    def __init__(self, device, delay, modifier_delay=0.06):
        self.fd = os.open(device, os.O_RDWR | os.O_NONBLOCK)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self.fd)
            raise
        self.delay = delay
        self.modifier_delay = modifier_delay
        self.modifier = 0
        self.key = 0

    def write(self, report, timeout=3):
        deadline = time.monotonic() + timeout
        while True:
            try:
                count = os.write(self.fd, report)
                if count != len(report):
                    raise RuntimeError('Incomplete HID report')
                return
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('USB host is not accepting reports; reconnect before retrying')
                select.select([], [self.fd], [], remaining)

    def press(self, modifier, code):
        # SmileBASIC polls input. Let it see a modifier change before the key.
        if modifier != self.modifier:
            self.write(bytes([modifier, 0, 0, 0, 0, 0, 0, 0]))
            self.modifier = modifier
            self.key = 0
            time.sleep(self.modifier_delay)
        if self.key == code:
            self.write(bytes([modifier, 0, 0, 0, 0, 0, 0, 0]))
            self.key = 0
            time.sleep(self.delay)
        self.write(bytes([modifier, 0, code, 0, 0, 0, 0, 0]))
        self.key = code
        time.sleep(self.delay)

    def tap(self, modifier, code):
        self.press(modifier, code)
        self.write(bytes([modifier, 0, 0, 0, 0, 0, 0, 0]))
        self.key = 0
        time.sleep(self.delay)

    def isolated_tap(self, modifier, code):
        """A complete press/release cycle, including release of modifiers."""
        self.write(RELEASE)
        self.modifier = 0
        self.key = 0
        time.sleep(self.delay)
        if modifier:
            self.write(bytes([modifier, 0, 0, 0, 0, 0, 0, 0]))
            time.sleep(self.modifier_delay)
        self.write(bytes([modifier, 0, code, 0, 0, 0, 0, 0]))
        time.sleep(self.delay)
        self.write(RELEASE)
        self.modifier = 0
        self.key = 0

    def close(self):
        try:
            self.write(RELEASE, timeout=0.3)
        finally:
            os.close(self.fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--file', type=Path)
    group.add_argument('--text')
    group.add_argument('--key', choices=SPECIAL)
    parser.add_argument('--device', default='/dev/hidg0')
    parser.add_argument('--send', action='store_true')
    parser.add_argument('--delay', type=float, default=0.06,
                        help='seconds for each key-down and key-up; default 0.06')
    parser.add_argument('--modifier-delay', type=float, default=0.06)
    parser.add_argument('--newline-delay', type=float, default=0.3)
    parser.add_argument('--before-newline-delay', type=float, default=0.0)
    parser.add_argument('--completion-close-delay', type=float, default=0.2)
    parser.add_argument('--end-line-pause', type=float, default=0.0,
                        help='extra pauses around standalone END lines only')
    parser.add_argument('--editor-lines', action='store_true',
                        help='clear inherited indentation with Home/Ctrl+Delete before each line')
    parser.add_argument('--stream', action='store_true',
                        help='release distinct keys in the following report; preserve long key holds')
    parser.add_argument('--safe-editor', action='store_true',
                        help='isolated keys, select inherited indentation, Escape before every Enter')
    args = parser.parse_args()
    if not 0.02 <= args.delay <= 1:
        parser.error('--delay must be between 0.02 and 1 second')
    if not 0.02 <= args.modifier_delay <= 1 or not 0 <= args.newline_delay <= 2:
        parser.error('Invalid modifier or newline delay')
    if not 0 <= args.before_newline_delay <= 3 or not 0 <= args.completion_close_delay <= 3:
        parser.error('Invalid before-newline or completion-close delay')
    if not 0 <= args.end_line_pause <= 10:
        parser.error('Invalid END-line pause')
    if args.end_line_pause and not args.safe_editor:
        parser.error('--end-line-pause requires --safe-editor')
    if args.safe_editor and (args.stream or args.editor_lines):
        parser.error('--safe-editor replaces --stream and --editor-lines')
    if args.key:
        text = ''
    elif args.text is not None:
        text = args.text
    else:
        file = args.file or Path(__file__).with_name('bootstrap.bas')
        text = file.read_bytes().decode('ascii')
    unsupported = sorted(set(text) - KEYS.keys())
    if unsupported:
        parser.error(f'Unsupported characters: {unsupported!r}')
    info = {'characters': len(text), 'lines': len(text.splitlines()),
            'sha256': hashlib.sha256(text.encode('ascii')).hexdigest(),
            'send': args.send, 'editor_lines': args.editor_lines, 'stream': args.stream,
            'safe_editor': args.safe_editor,
            'before_newline_delay': args.before_newline_delay,
            'newline_delay': args.newline_delay,
            'completion_close_delay': args.completion_close_delay,
            'end_line_pause': args.end_line_pause,
            'standalone_END_lines': sum(line.strip().upper() == 'END' for line in text.splitlines())}
    print(json.dumps(info), flush=True)
    if not args.send:
        return
    state = Path('/sys/class/udc/fc000000.usb/state').read_text().strip()
    if state != 'configured':
        raise RuntimeError(f'USB keyboard is not configured by a host: {state}')
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    keyboard = Keyboard(args.device, args.delay, args.modifier_delay)
    try:
        keyboard.write(RELEASE)
        time.sleep(args.modifier_delay)
        if args.key:
            keyboard.tap(0, SPECIAL[args.key])
        else:
            start_of_line = True
            line = 1
            end_count = 0
            source_lines = text.splitlines()
            for ch in text:
                is_end_line = source_lines[line-1].strip().upper() == 'END'
                if start_of_line and is_end_line and args.end_line_pause:
                    print(f'Pause before END on source line {line}', flush=True)
                    time.sleep(args.end_line_pause)
                if start_of_line and args.safe_editor:
                    # On a new line the cursor follows inherited indentation.
                    # Delete a selection only; never use Ctrl+Delete.
                    keyboard.isolated_tap(SHIFT, SPECIAL['home'])
                    keyboard.isolated_tap(0, SPECIAL['delete'])
                if start_of_line and args.editor_lines:
                    keyboard.tap(0, SPECIAL['home'])
                    keyboard.tap(CTRL, SPECIAL['delete'])
                start_of_line = False
                if args.safe_editor and ch == '\n':
                    # Enter otherwise accepts an autocomplete candidate instead
                    # of inserting a newline, particularly after short words.
                    time.sleep(max(args.before_newline_delay,
                                   args.end_line_pause if is_end_line else 0))
                    if source_lines[line-1].strip():
                        keyboard.isolated_tap(0, SPECIAL['escape'])
                        time.sleep(args.completion_close_delay)
                    keyboard.isolated_tap(*KEYS[ch])
                elif args.safe_editor:
                    keyboard.isolated_tap(*KEYS[ch])
                elif args.stream and ch != '\n':
                    keyboard.press(*KEYS[ch])
                else:
                    keyboard.tap(*KEYS[ch])
                if ch == '\n':
                    next_is_end = line < len(source_lines) and source_lines[line].strip().upper() == 'END'
                    time.sleep(max(args.newline_delay,
                                   args.end_line_pause if is_end_line or next_is_end else 0))
                    if args.safe_editor and source_lines[line-1].strip().upper() == 'END':
                        end_count += 1
                        print(f'END transmitted on source line {line} (count {end_count})', flush=True)
                        time.sleep(0.8)
                    print(f'Completed line {line}/{info["lines"]}', flush=True)
                    line += 1
                    start_of_line = True
        print('Finished. Keys released. Nothing was run or saved automatically.', flush=True)
    finally:
        keyboard.close()


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, OSError, RuntimeError) as error:
        print(f'Stopped: {error}', file=sys.stderr)
        sys.exit(1)
