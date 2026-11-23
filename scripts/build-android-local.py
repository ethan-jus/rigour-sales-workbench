#!/usr/bin/env python3
"""Build the current uni-app x app locally; signing stays outside Git."""
import argparse, fcntl, hashlib, io, json, os, pathlib, re, shutil, subprocess, sys, time, urllib.request, zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
OUT = ROOT / 'outputs/android-local'
PROJECT = OUT / 'project'
SDK_NAME = 'Android-uni-app-x-SDK@15075-5.26'
SDK_SHA = '3a97adb960eb753cc872983fd830e382cf7df7537b764e34b4d9220779a0af8b'
SDK = OUT / 'sdk' / SDK_NAME
PACKAGE = 'com.rigour.workbench'
ANDROID = pathlib.Path(os.environ.get('ANDROID_HOME', str(pathlib.Path.home() / 'Library/Android/sdk')))
BUILD_TOOLS = ANDROID / 'build-tools/36.1.0'
CLI = pathlib.Path(os.environ.get('HBUILDERX_CLI', '/Applications/HBuilderX.app/Contents/MacOS/cli'))
GRADLE = pathlib.Path(os.environ.get('RIGOUR_GRADLE', str(pathlib.Path.home() / '.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle')))
ENV = dict(os.environ)
A = '{http://schemas.android.com/apk/res/android}'
ET.register_namespace('android', A[1:-1]); ET.register_namespace('tools', 'http://schemas.android.com/tools')

def run(args, capture=False, env=None, cwd=ROOT):
    result = subprocess.run([str(x) for x in args], cwd=cwd, env=env or ENV, text=True, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
    if result.returncode:
        if capture: print(result.stdout)
        raise RuntimeError(f'{pathlib.Path(str(args[0])).name} failed ({result.returncode})')
    return result.stdout or ''

def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir(): shutil.copytree(source, target, dirs_exist_ok=True)
    else: shutil.copy2(source, target)

def certificate(apk):
    text = run([BUILD_TOOLS / 'apksigner', 'verify', '--print-certs', apk], True)
    match = re.search(r'certificate SHA-256 digest: (\w+)', text)
    if not match: raise RuntimeError('APK signing certificate missing')
    return match.group(1)

def build(install=False):
    started = time.monotonic()
    signing_path = pathlib.Path(os.environ.get('RIGOUR_SIGNING_CONFIG', str(OUT / 'signing.local.json')))
    signing = json.loads(signing_path.read_text())
    if signing['packagename'] != PACKAGE: raise RuntimeError('Signing config package mismatch')
    if not signing.get('certificateSha256'): raise RuntimeError('Pin the existing release certificate SHA-256 in signing.local.json first')
    version = run(['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleShortVersionString', CLI.parents[1] / 'Info.plist'], True).strip()
    if version != '5.26.2026091802': raise RuntimeError('Expected HBuilderX 5.26.2026091802; update SDK and compiler together')
    ENV['JAVA_HOME'] = run(['/usr/libexec/java_home', '-v', '21'], True).strip()
    archive = OUT / 'Android-uni-app-x-SDK-5.26.zip'
    if not archive.exists():
        print('Downloading pinned official SDK...', flush=True)
        temporary = archive.with_suffix('.download')
        urllib.request.urlretrieve('https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/Android/Android-uni-app-x-SDK@15075-5.26.zip', temporary)
        temporary.replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SDK_SHA: raise RuntimeError('Official SDK archive checksum mismatch')
    if not SDK.exists():
        with zipfile.ZipFile(archive) as z:
            z.extractall(OUT / 'sdk', members=[n for n in z.namelist() if n.startswith(SDK_NAME + '/')])
    print('Exporting release resources locally...', flush=True)
    export = run([CLI, 'publish', 'app-android', '--type', 'appResource', '--project', APP], True)
    print(export)
    if '导出 android 成功' not in export or '编译失败' in export: raise RuntimeError('Missing Android resource export success receipt')
    resources = APP / 'unpackage/resources/app-android'
    manifest = json.loads((APP / 'manifest.json').read_text())
    if manifest['appid'] != '__UNI__EE5460C' or manifest['uni-app-x']['vapor']: raise RuntimeError('App identity/rendering mode changed')
    config_text = (APP / 'services/config.uts').read_text()
    if not re.search(r"environment:\s*'production'", config_text) or not re.search(r"gatewayOrigin:\s*'https://scm\.wpbsaedu\.cn'", config_text): raise RuntimeError('Production origin not configured')
    exported = json.loads((resources / manifest['appid'] / 'www/manifest.json').read_text())
    if exported['version']['code'] != manifest['versionCode']: raise RuntimeError('Export version mismatch')
    # Replace only generated sources/assets, preserving Gradle incremental caches.
    for name in ['src', 'libs']:
        shutil.rmtree(PROJECT / name, ignore_errors=True)
    PROJECT.mkdir(parents=True, exist_ok=True)
    for name in ['build.gradle', 'settings.gradle']: copy(ROOT / 'scripts/android-local' / name, PROJECT / name)
    (PROJECT / 'local.properties').write_text('sdk.dir=' + str(ANDROID) + '\n')
    (PROJECT / 'gradle.properties').write_text('org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\norg.gradle.workers.max=4\n')
    copy(resources / 'uniappx/app-android/src', PROJECT / 'src/main/java')
    copy(resources / manifest['appid'], PROJECT / 'src/main/assets/apps' / manifest['appid'])
    root = ET.parse(ROOT / 'scripts/android-local/AndroidManifest.xml').getroot()
    application = root.find('application')
    extension = ET.parse(APP / 'AndroidManifest.xml').getroot()
    for node in extension:
        if node.tag == 'application':
            for child in node: application.append(child)
        else: root.append(node)
    plugin_projects = []
    for plugin in (resources / 'uni_modules').iterdir():
        native = plugin / 'utssdk/app-android'
        destination = PROJECT / plugin.name
        shutil.rmtree(destination / 'src', ignore_errors=True)
        copy(native / 'src', destination / 'src/main/java')
        config = json.loads((native / 'config.json').read_text())
        pmanifest = ET.parse(native / 'AndroidManifest.xml').getroot()
        namespace = pmanifest.attrib.pop('package')
        ET.ElementTree(pmanifest).write(destination / 'src/main/AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
        template = (ROOT / 'scripts/android-local/plugin.gradle').read_text()
        (destination / 'build.gradle').write_text(template.replace('PLUGIN_NAMESPACE', namespace))
        (destination / 'dependencies.gradle').write_text('dependencies {\n' + ''.join('    implementation ' + json.dumps(dep) + '\n' for dep in config.get('dependencies', [])) + '}\n')
        for name, dest in [('res', 'src/main/res'), ('assets', 'src/main/assets'), ('libs', 'libs')]:
            if (native / name).exists(): copy(native / name, destination / dest)
        plugin_projects.append(plugin.name)
    with (PROJECT / 'settings.gradle').open('a') as settings:
        settings.write(''.join("\ninclude ':" + name + "'\n" for name in plugin_projects))
    (PROJECT / 'plugins.gradle').write_text('dependencies {\n' + ''.join("    implementation project(':" + name + "')\n" for name in plugin_projects) + '}\n')
    copy(APP / 'nativeResources/android/res', PROJECT / 'src/main/res')
    for density, source in manifest['app-android']['distribute']['icons'].items():
        copy(APP / source, PROJECT / f'src/main/res/mipmap-{density}/icon.png')
    ET.ElementTree(root).write(PROJECT / 'src/main/AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    base = ['uts-runtime', 'app-common', 'app-runtime', 'breakpad-build', 'dcloud-layout', 'framework', 'uni-exit', 'uni-getAccessibilityInfo', 'uni-getDeviceInfo', 'uni-getSystemInfo', 'uni-getSystemSetting', 'uni-rpx2px', 'uni-theme', 'uni-getProvider', 'uni-actionSheet', 'uni-modal', 'uni-picker', 'uni-location-system', 'nativeobj-preview', 'audio-mp3aac']
    modules = set(base) | set(exported['app-android']['distribute']['modules'])
    # getElementById is part of the VDOM runtime, not a separate SDK artifact.
    modules.discard('uni-getElementById')
    easycom = []
    for name in sorted(modules):
        aar = SDK / 'SDK/libs' / (name + '-release.aar')
        if not aar.exists(): raise RuntimeError('SDK module missing: ' + name)
        copy(aar, PROJECT / 'libs' / aar.name)
        with zipfile.ZipFile(aar) as z:
            if 'classes.jar' not in z.namelist(): continue
            with zipfile.ZipFile(io.BytesIO(z.read('classes.jar'))) as classes:
                for cls in classes.namelist():
                    if re.search(r'ExtApi(?:Pages|Components)Register\.class$', cls):
                        easycom.append({'class': cls[:-6].replace('/', '.'), 'method': 'register'})
    gif = SDK / 'SDK/libs/android-gif-drawable-1.2.30.aar'; copy(gif, PROJECT / 'libs' / gif.name)
    (PROJECT / 'release.json').write_text(json.dumps({'versionCode': manifest['versionCode'], 'versionName': manifest['versionName'], 'easycom': json.dumps(easycom)}))
    print('Compiling native APK with local Gradle...', flush=True)
    run([GRADLE, '--console=plain', 'assembleRelease'], cwd=PROJECT)
    unsigned = PROJECT / 'build/outputs/apk/release/project-release-unsigned.apk'
    if not unsigned.exists():
        candidates = list((PROJECT / 'build/outputs/apk/release').glob('*-unsigned.apk'))
        if len(candidates) != 1: raise RuntimeError('Unsigned APK not uniquely identified')
        unsigned = candidates[0]
    aligned = OUT / 'aligned.apk'
    run([BUILD_TOOLS / 'zipalign', '-f', '-p', '4', unsigned, aligned])
    apk = OUT / ('rigour-sales-' + manifest['versionName'] + '.apk')
    secret_env = dict(ENV, RIGOUR_STORE_PASSWORD=signing['storepassword'], RIGOUR_KEY_PASSWORD=signing['certpassword'])
    run([BUILD_TOOLS / 'apksigner', 'sign', '--ks', signing['certfile'], '--ks-key-alias', signing['certalias'], '--ks-pass', 'env:RIGOUR_STORE_PASSWORD', '--key-pass', 'env:RIGOUR_KEY_PASSWORD', '--out', apk, aligned], env=secret_env)
    cert = certificate(apk)
    if cert != signing['certificateSha256']: raise RuntimeError('Release certificate mismatch; refusing installation')
    badging = run([BUILD_TOOLS / 'aapt', 'dump', 'badging', apk], True)
    if "package: name='com.rigour.workbench'" not in badging or 'application-debuggable' in badging: raise RuntimeError('APK identity/debuggable verification failed')
    if f"versionCode='{manifest['versionCode']}'" not in badging or f"versionName='{manifest['versionName']}'" not in badging: raise RuntimeError('APK version does not match manifest')
    print('Release APK:', apk, '\nSHA256:', hashlib.sha256(apk.read_bytes()).hexdigest(), '\nBuild seconds:', round(time.monotonic() - started, 1), flush=True)
    if install:
        adb = ANDROID / 'platform-tools/adb'
        devices = [line.split()[0] for line in run([adb, 'devices'], True).splitlines()[1:] if line.endswith('\tdevice')]
        if len(devices) != 1: raise RuntimeError('Connect exactly one authorized Redmi before installing')
        prefix = [adb, '-s', devices[0]]
        installed = run(prefix + ['shell', 'pm', 'path', PACKAGE], True).strip().splitlines()
        if not installed: raise RuntimeError('Existing app missing; refusing fresh installation')
        base_apk = OUT / 'installed-base.apk'
        run(prefix + ['pull', installed[0].removeprefix('package:'), base_apk], True)
        if certificate(base_apk) != cert: raise RuntimeError('Phone signature mismatch; app/data were not changed')
        run(prefix + ['install', '-r', apk])
        run(prefix + ['shell', 'am', 'start', '-n', PACKAGE + '/io.dcloud.uniapp.UniAppActivity'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--install', action='store_true'); args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / 'build.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            build(args.install)
        except Exception as error:
            print('Local build stopped:', error, file=sys.stderr); sys.exit(1)
