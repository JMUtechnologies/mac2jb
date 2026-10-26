#!/usr/bin/env python3
"""Audit complete source distributions and the explicitly approved driver."""
import hashlib
import json
import stat
import sys
import zipfile
from pathlib import PurePosixPath

if len(sys.argv) != 2:
    raise SystemExit('usage: python3 scripts/audit-release.py mac2jb-complete.zip')

archive = sys.argv[1]
required = {
    'mac2jb/LICENSE',
    'mac2jb/vendor/libusbd/LICENSE',
    'mac2jb/vendor/libusbd/LICENSE-APSL-2.0.txt',
    'mac2jb/vendor/macos_usb_gadget_poc/LICENSE-APSL-2.0.txt',
    'mac2jb/vendor/macos_usb_gadget_poc/usbgadget/LICENSE',
    'mac2jb/vendor/ns2jb/run.cjs',
    'mac2jb/vendor/HBLauncher/homebrew-launcher/launcher.cjs',
    'mac2jb/scripts/gui-homebrew.cjs',
    'mac2jb/scripts/gui-stremio.cjs',
    'mac2jb/scripts/gui-ouncecake.cjs',
    'mac2jb/vendor/OunceCake/LICENSE',
    'mac2jb/vendor/OunceCake/README.md',
    'mac2jb/vendor/OunceCake/engine/oz-code/native.c',
    'mac2jb/vendor/OunceCake/engine/oz-code/native.h',
    'mac2jb/vendor/OunceCake/engine/oz-code/layout.ld',
    'mac2jb/vendor/OunceCake/engine/oz-code/native.bin',
    'mac2jb/vendor/OunceCake/engine/build-ftp.cjs',
    'mac2jb/packaging/OunceCake-provenance.json',
    'mac2jb/packaging/OunceCake-SHA256SUMS',
    'mac2jb/packaging/OunceCake-upstream-SHA256SUMS',
    'mac2jb/stremio/pipeline.cjs',
    'mac2jb/stremio/app/app.frag.spv',
    'mac2jb/assets/stremio/bbb-sample.mp4',
    'mac2jb/assets/stremio/ATTRIBUTION.md',
    'mac2jb/packaging/stremio-sample-provenance.json',
    'mac2jb/packaging/homebrew-runtime.lock.json',
    'mac2jb/packaging/HBLauncher-v0.2.0-SHA256SUMS',
    'mac2jb/packaging/ftpd-sb-v0.1.0-SHA256SUMS',
    'mac2jb/packaging/ftpd-sb-v0.1.0-release-SHA256SUMS',
    'mac2jb/packaging/ftpd-sb-v0.1.0-provenance.json',
    'mac2jb/scripts/prepare-homebrew-apps.cjs',
    'mac2jb/assets/homebrew-apps/ftpd-sb/README.md',
    'mac2jb/assets/homebrew-apps/ftpd-sb/app.json',
    'mac2jb/drivers/README.md',
    'mac2jb/drivers/LICENSE',
    'mac2jb/drivers/LICENSE-APSL-2.0.txt',
    'mac2jb/drivers/SHA256SUMS',
    'mac2jb/scripts/install-driver.sh',
    'mac2jb/assets/bootstrap.bas',
    'mac2jb/mac2jb.command',
    'mac2jb/setup.sh',
    'mac2jb/vendor/macos_usb_gadget_poc/usbgadget/usbgadget.xcodeproj/project.pbxproj',
}
block_names = ('mac2jb-send', 'mac2jb-commands', '.DS_Store')
block_suffixes = ('.o', '.dylib', '.log', '.xcuserstate', '.pyc', '.bak')
violations = []
with zipfile.ZipFile(archive) as z:
    names = set(z.namelist())
    for missing in sorted(required - names):
        violations.append('missing required file: ' + missing)
    for path in sorted(names):
        p = PurePosixPath(path)
        if path.startswith('/') or '..' in p.parts or '\\' in path:
            violations.append('unsafe archive path: ' + path)
        if ('.git' in p.parts or '__MACOSX' in p.parts or
                any(name in p.parts for name in ('runs', 'dumps')) and any(vendor in path for vendor in ('vendor/ns2jb/', 'vendor/HBLauncher/'))):
            violations.append('Git metadata or ns2jb runtime data: ' + path)
        if p.parts[:3] == ('mac2jb', 'vendor', 'HBLauncher') and len(p.parts)>3 and p.parts[3] in ('tools', 'dist'):
            violations.append('generated Homebrew artifact: ' + path)
        approved_driver = path.startswith('mac2jb/drivers/usbgadget.kext/')
        if ('usbgadget.kext' in p.parts and not approved_driver or 'usb_device' in p.parts or
            'xcuserdata' in p.parts or 'project.xcworkspace' in p.parts or p.name.startswith('._') or
            p.name in block_names or p.suffix in block_suffixes):
            violations.append('excluded binary/local/unused file: ' + path)
    driver_files = {
        'Contents/Info.plist': 'c38786b3eb1b51055505bca54c88df77b797e1785c146ec1d54ee3273a934faf',
        'Contents/MacOS/usbgadget': 'a32119c7908098c49c2540a17aad4d172378de969885ad4f4a752bdb8ef91308',
    }
    prefix = 'mac2jb/drivers/usbgadget.kext/'
    for suffix, expected in driver_files.items():
        name = prefix + suffix
        if name not in names or hashlib.sha256(z.read(name)).hexdigest() != expected:
            violations.append('missing or changed approved unsigned driver: ' + name)
    for name in names:
        if name.startswith(prefix) and not name.endswith('/') and name[len(prefix):] not in driver_files:
            violations.append('unexpected driver file or signing metadata: ' + name)
    ounce_manifest = 'mac2jb/packaging/OunceCake-SHA256SUMS'
    ounce_prefix = 'mac2jb/vendor/OunceCake/'
    if ounce_manifest in names:
        try:
            expected = {}
            for line in z.read(ounce_manifest).decode().splitlines():
                digest, relative = line.split('  ', 1)
                if (len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest)
                        or relative.startswith('/') or '..' in PurePosixPath(relative).parts
                        or '\\' in relative or ounce_prefix + relative in expected):
                    raise ValueError('invalid OunceCake manifest')
                expected[ounce_prefix + relative] = digest
            actual = {name for name in names if name.startswith(ounce_prefix) and not name.endswith('/')}
            if len(expected) != 17 or actual != set(expected):
                violations.append('incomplete or unexpected OunceCake source distribution')
            for name, digest in expected.items():
                if name not in names or hashlib.sha256(z.read(name)).hexdigest() != digest:
                    violations.append('missing or changed OunceCake source: ' + name)
            native = ounce_prefix + 'engine/oz-code/native.bin'
            if hashlib.sha256(z.read(native)).hexdigest() != '9af1776daae66e5566b9fb52e9017b6b78203e4c93d3b63d7000f0196eb5ff1e':
                violations.append('changed pinned OunceCake native image')
            provenance = json.loads(z.read('mac2jb/packaging/OunceCake-provenance.json'))
            if provenance.get('commit') != 'e3bcbd229be2229d44f036455adddda921ade3b2' or provenance.get('license') != 'GPLv2':
                violations.append('changed OunceCake upstream provenance')
            if b'GNU GENERAL PUBLIC LICENSE' not in z.read(ounce_prefix + 'LICENSE'):
                violations.append('missing OunceCake GPL license text')
        except (KeyError, ValueError, UnicodeError):
            violations.append('missing or malformed OunceCake source/provenance')
    # The app overlay must be the exact published package, independently of
    # the frozen HBLauncher tree and its unchanged integrity manifest.
    ftpd_manifest = 'mac2jb/packaging/ftpd-sb-v0.1.0-SHA256SUMS'
    ftpd_published = 'mac2jb/packaging/ftpd-sb-v0.1.0-release-SHA256SUMS'
    if (ftpd_published not in names or hashlib.sha256(z.read(ftpd_published)).hexdigest() !=
            'a162967e19d004564301f0607690ebae1cea7b3acf402345016607e9409b2381'):
        violations.append('missing or changed published ftpd-sb archive checksums')
    if ftpd_manifest in names:
        manifest_bytes = z.read(ftpd_manifest)
        if hashlib.sha256(manifest_bytes).hexdigest() != '0f085741f5707a41458be681eb7d2241cbc49f0574f5b0a4b3abba907f20214b':
            violations.append('changed pinned ftpd-sb integrity manifest')
        else:
            app_prefix = 'mac2jb/assets/homebrew-apps/ftpd-sb/'
            expected = {}
            for line in manifest_bytes.decode().splitlines():
                digest, relative = line.split('  ', 1)
                expected[app_prefix + relative] = digest
            actual = {name for name in names if name.startswith(app_prefix) and not name.endswith('/')}
            if actual != set(expected):
                violations.append('missing or unexpected ftpd-sb package files')
            for name, digest in expected.items():
                if name not in names or hashlib.sha256(z.read(name)).hexdigest() != digest:
                    violations.append('missing or changed released ftpd-sb file: ' + name)
                elif stat.S_IFMT(z.getinfo(name).external_attr >> 16) not in (0, stat.S_IFREG):
                    violations.append('non-regular ftpd-sb archive member: ' + name)
            try:
                provenance = json.loads(z.read('mac2jb/packaging/ftpd-sb-v0.1.0-provenance.json'))
                if (provenance.get('commit') != 'ab2123cfb97d492264bf6609cb410e285d6d9b5f' or
                        provenance.get('asset', {}).get('digest') != 'sha256:e3c0e0387d2cdaa6b9345cd8e601cab584f7e46c5f16a285a39c368b5d33140e'):
                    violations.append('changed ftpd-sb release provenance')
            except (KeyError, ValueError):
                violations.append('missing or malformed ftpd-sb release provenance')

if violations:
    for v in violations:
        print('FAIL:', v, file=sys.stderr)
    raise SystemExit(1)
print(f'PASS: {archive} contains expected source, licenses, and the approved unsigned driver without excluded artifacts.')
