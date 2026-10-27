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
    'mac2jb/README.md',
    'mac2jb/.github/workflows/build.yml',
    'mac2jb/LICENSE',
    'mac2jb/vendor/libusbd/LICENSE',
    'mac2jb/vendor/libusbd/LICENSE-APSL-2.0.txt',
    'mac2jb/vendor/macos_usb_gadget_poc/LICENSE-APSL-2.0.txt',
    'mac2jb/vendor/macos_usb_gadget_poc/usbgadget/LICENSE',
    'mac2jb/vendor/ns2jb/run.cjs',
    'mac2jb/vendor/ns2jb-hosts/pepsipu/run.cjs',
    'mac2jb/vendor/ns2jb-hosts/kurumuz/run.cjs',
    'mac2jb/gui/HostProfile.swift',
    'mac2jb/scripts/host-profiles.cjs',
    'mac2jb/scripts/prepare-host-profiles.cjs',
    'mac2jb/packaging/host-profiles.json',
    'mac2jb/scripts/gui-attach.cjs',
    'mac2jb/scripts/rpc-attachment.cjs',
    'mac2jb/vendor/HBLauncher/homebrew-launcher/launcher.cjs',
    'mac2jb/vendor/GPUBrewLauncher/homebrew-launcher/launcher.cjs',
    'mac2jb/vendor/GPUBrewLauncher/CREDITS',
    'mac2jb/vendor/GPUBrewLauncher/REFERENCE.md',
    'mac2jb/scripts/gui-gpubrewlauncher.cjs',
    'mac2jb/scripts/gui-hblauncher.cjs',
    'mac2jb/scripts/gui-izlauncher.cjs',
    'mac2jb/scripts/prepare-izlauncher.cjs',
    'mac2jb/scripts/check-izlauncher-runtime.cjs',
    'mac2jb/vendor/IZ2S-Platform/LICENSE',
    'mac2jb/vendor/IZ2S-Platform/COPYRIGHT',
    'mac2jb/vendor/IZ2S-Platform/LICENSE-SCOPE.md',
    'mac2jb/vendor/IZ2S-Platform/THIRD_PARTY.json',
    'mac2jb/vendor/IZ2S-Platform/shells/izlauncher/server/runtime.cjs',
    'mac2jb/vendor/IZ2S-Platform/modules/iz-exchange/module.json',
    'mac2jb/packaging/IZ2S-Platform-provenance.json',
    'mac2jb/packaging/IZ2S-Platform-SHA256SUMS',
    'mac2jb/packaging/GPUBrewLauncher-provenance.json',
    'mac2jb/packaging/GPUBrewLauncher-SHA256SUMS',
    'mac2jb/scripts/gui-homebrew.cjs',
    'mac2jb/scripts/gui-stremio.cjs',
    'mac2jb/scripts/gui-ouncecake.cjs',
    'mac2jb/keyboard.c',
    'mac2jb/gui/PostBootstrapCommand.swift',
    'mac2jb/scripts/gui-keyboard.cjs',
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
    'mac2jb/stremio/receiver.cjs',
    'mac2jb/stremio/receiver-program.cjs',
    'mac2jb/stremio/test-receiver.cjs',
    'mac2jb/stremio/test-receiver-program.cjs',
    'mac2jb/stremio/test-receiver-lifecycle.cjs',
    'mac2jb/stremio/benchmark-transport.cjs',
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
block_names = ('mac2jb-send', 'mac2jb-commands', 'mac2jb-keyboard', '.DS_Store',
               'DemoBootstrapSetup.swift', 'demo-save.bas')
block_suffixes = ('.o', '.dylib', '.log', '.xcuserstate', '.pyc', '.bak', '.kate-swp')
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
                any(name in p.parts for name in ('runs', 'dumps')) and any(vendor in path for vendor in ('vendor/ns2jb/', 'vendor/ns2jb-hosts/', 'vendor/HBLauncher/', 'vendor/GPUBrewLauncher/'))):
            violations.append('Git metadata or ns2jb runtime data: ' + path)
        if p.parts[:2] == ('mac2jb', 'vendor') and len(p.parts)>3 and p.parts[2] in ('HBLauncher', 'GPUBrewLauncher') and p.parts[3] in ('tools', 'dist'):
            violations.append('generated Homebrew artifact: ' + path)
        approved_driver = path.startswith('mac2jb/drivers/usbgadget.kext/')
        if ('usbgadget.kext' in p.parts and not approved_driver or 'usb_device' in p.parts or
            'xcuserdata' in p.parts or 'project.xcworkspace' in p.parts or p.name.startswith('._') or
            p.name in block_names or p.suffix in block_suffixes or any(part.endswith('.dSYM') for part in p.parts)):
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
    host_profiles = 'mac2jb/packaging/host-profiles.json'
    if host_profiles in names:
        try:
            registry = json.loads(z.read(host_profiles))
            pins = {
                'pepsipu': '95f5525089273c5fce0b95047f3600f8442e96ae',
                'kurumuz': '857aa2c7240218580250cb777dc0c2ceecff56cb',
                'BermTheSequel': '84619429e937c132e27a6d576892515ea0018d86',
            }
            profiles = registry['profiles']
            if (registry.get('format') != 'mac2jb-host-profiles-v1' or registry.get('default') != 'BermTheSequel'
                    or len(profiles) != 3 or {row['id'] for row in profiles} != set(pins)):
                raise ValueError('invalid host profile registry')
            for row in profiles:
                host = row['id']
                folder = 'vendor/ns2jb' if host == 'BermTheSequel' else 'vendor/ns2jb-hosts/' + host
                if (row['label'] != host or row['revision'] != pins[host] or row['sourceDirectory'] != folder
                        or row['startArgumentCount'] != (9 if host == 'pepsipu' else 5)
                        or row['supportsHeldRPC'] != (host != 'pepsipu')
                        or row['supportsDemo'] != (host == 'BermTheSequel') or not row.get('licenseStatus')):
                    raise ValueError('changed host provenance or capabilities')
                prefix = 'mac2jb/' + folder + '/'
                expected = {}
                for line in z.read(prefix + 'SHA256SUMS').decode().splitlines():
                    digest, relative = line.split('  ', 1)
                    if (len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest)
                            or relative.startswith('/') or '..' in PurePosixPath(relative).parts
                            or '\\' in relative or relative in expected):
                        raise ValueError('invalid host checksum manifest')
                    expected[relative] = digest
                actual = {name[len(prefix):] for name in names if name.startswith(prefix) and not name.endswith('/')}
                if actual != set(expected) | {'SHA256SUMS'}:
                    violations.append('incomplete or unexpected host distribution: ' + host)
                for relative, digest in expected.items():
                    name = prefix + relative
                    if name not in names or hashlib.sha256(z.read(name)).hexdigest() != digest:
                        violations.append('missing or changed host source: ' + name)
                source_names = ['run.cjs', 'bootstrap.bas'] + (['rpc.cjs', 'dump-firmware.cjs'] if row['supportsHeldRPC'] else [])
                source_names += [name for name in expected if name.startswith('engine/')]
                entries = [[name, hashlib.sha256(z.read(prefix + name)).hexdigest()] for name in sorted(source_names)]
                source_digest = hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()
                bootstrap = z.read('mac2jb/' + row['bootstrap'])
                if (source_digest != row['sourceSha256'] or hashlib.sha256(bootstrap).hexdigest() != row['bootstrapSha256']
                        or bootstrap != z.read(prefix + 'bootstrap.bas')):
                    violations.append('changed host source or bootstrap digest: ' + host)
                if 'mac2jb/' + row['upstreamManifest'] not in names or prefix + 'README.md' not in names:
                    violations.append('missing original host notices or integrity manifest: ' + host)
        except (KeyError, ValueError, TypeError, UnicodeError):
            violations.append('missing or malformed pinned host sources/provenance')
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
    gpu_manifest = 'mac2jb/packaging/GPUBrewLauncher-SHA256SUMS'
    gpu_prefix = 'mac2jb/vendor/GPUBrewLauncher/'
    if gpu_manifest in names:
        try:
            expected = {}
            for line in z.read(gpu_manifest).decode().splitlines():
                digest, relative = line.split('  ', 1)
                if (len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest)
                        or relative.startswith('/') or '..' in PurePosixPath(relative).parts
                        or '\\' in relative or gpu_prefix + relative in expected):
                    raise ValueError('invalid GPUBrewLauncher manifest')
                expected[gpu_prefix + relative] = digest
            actual = {name for name in names if name.startswith(gpu_prefix) and not name.endswith('/')}
            if not expected or actual != set(expected):
                violations.append('incomplete or unexpected GPUBrewLauncher source distribution')
            for name, digest in expected.items():
                if name not in names or hashlib.sha256(z.read(name)).hexdigest() != digest:
                    violations.append('missing or changed GPUBrewLauncher source: ' + name)
            provenance = json.loads(z.read('mac2jb/packaging/GPUBrewLauncher-provenance.json'))
            if provenance.get('commit') != 'f35ff64ea4b9b42cf2a75095d24662fe250f03e4':
                violations.append('changed GPUBrewLauncher upstream provenance')
        except (KeyError, ValueError, UnicodeError):
            violations.append('missing or malformed GPUBrewLauncher source/provenance')
    iz_manifest = 'mac2jb/packaging/IZ2S-Platform-SHA256SUMS'
    iz_prefix = 'mac2jb/vendor/IZ2S-Platform/'
    try:
        manifest_bytes = z.read(iz_manifest)
        if hashlib.sha256(manifest_bytes).hexdigest() != 'fd35e84485e74aac2e2b8dd42bdf6d15b0125a643e3edd087ee413971f9e728b':
            raise ValueError('changed IZ2S manifest')
        expected = {}
        for line in manifest_bytes.decode().splitlines():
            digest, relative = line.split('  ', 1)
            if (len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest)
                    or relative.startswith('/') or '..' in PurePosixPath(relative).parts
                    or '\\' in relative or iz_prefix + relative in expected):
                raise ValueError('invalid IZ2S manifest')
            expected[iz_prefix + relative] = digest
        actual = {name for name in names if name.startswith(iz_prefix) and not name.endswith('/')}
        if len(expected) != 480 or actual != set(expected):
            violations.append('incomplete or unexpected IZ2S source distribution')
        for name, digest in expected.items():
            if name not in names or hashlib.sha256(z.read(name)).hexdigest() != digest:
                violations.append('missing or changed IZ2S source: ' + name)
        provenance = json.loads(z.read('mac2jb/packaging/IZ2S-Platform-provenance.json'))
        if provenance.get('commit') != '907de0d9f5a4e358079306e7f04a8c43d463142a' or provenance.get('modifications') != []:
            violations.append('changed IZ2S upstream provenance')
    except (KeyError, ValueError, UnicodeError):
        violations.append('missing or malformed IZ2S source/provenance')
    # The app overlay must be the exact published package, independently of
    # the frozen GPUBrewLauncher tree and its unchanged integrity manifest.
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
