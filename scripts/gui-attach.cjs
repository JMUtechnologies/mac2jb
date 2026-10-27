#!/usr/bin/env node
'use strict';
// Own only the local attachment authorization and selected app helper. The source host,
// its pairing record and held native resources belong to the original session.
const path = require('node:path');
const net = require('node:net');
const {spawn: spawnProcess} = require('node:child_process');
const {lines} = require('./gui-host.cjs');

const applications = Object.freeze({
  'launch-izlauncher': ['izlauncher', 'scripts/gui-izlauncher.cjs'],
  'launch-hblauncher': ['hblauncher', 'scripts/gui-hblauncher.cjs'],
  'launch-gpubrewlauncher': ['gpubrewlauncher', 'scripts/gui-gpubrewlauncher.cjs'],
  'launch-stremio': ['stremio', 'scripts/gui-stremio.cjs'],
  'launch-ouncecake': ['ouncecake', 'scripts/gui-ouncecake.cjs']
});
function launchConfiguration(command) {
  const selected = applications[command.action];
  if (!selected) throw Error('Choose a supported homebrew app.');
  const [application, script] = selected;
  if (application === 'ouncecake') {
    if (!net.isIPv4(command.consoleAddress)) throw Error('Enter the Switch’s IPv4 address for OunceCake FTP.');
    return {application, script, config: {consoleAddress: command.consoleAddress, port: 2121}};
  }
  if (application === 'stremio') {
    if (command.addonUrls !== undefined && (!Array.isArray(command.addonUrls) || command.addonUrls.length > 32 ||
        command.addonUrls.some(url => typeof url !== 'string' || url.length > 4096)) ||
        command.libraryItems !== undefined && (!Array.isArray(command.libraryItems) || command.libraryItems.length > 500 ||
        command.libraryItems.some(item => !item || typeof item !== 'object' || Array.isArray(item))))
      throw Error('The add-on configuration is invalid.');
    if (command.quality !== undefined && !['720p', '540p', '360p', '180p'].includes(command.quality))
      throw Error('Choose a supported Stremio quality.');
    return {application, script, quality: command.quality ?? '720p',
      config: {addonUrls: command.addonUrls || [], libraryItems: command.libraryItems || []}};
  }
  return {application, script, config: {}};
}
function validCatalog(games) {
  return Array.isArray(games) && games.length > 0 && games.length <= 1000 &&
    games.every(game => game && /^[a-f0-9]{16}$/.test(game.titleId) && typeof game.name === 'string' &&
      Buffer.byteLength(game.name) <= 160 && !/[\x00-\x1f\x7f]/.test(game.name) && Array.isArray(game.storages) &&
      game.storages.length >= 1 && game.storages.length <= 3 && new Set(game.storages).size === game.storages.length &&
      game.storages.every(value => [2, 4, 5].includes(value))) && new Set(games.map(game => game.titleId)).size === games.length;
}
function signalOwned(child, signal, group = false) {
  if (!child) return;
  try {
    if (group && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {if (error.code !== 'ESRCH') throw error;}
}

async function main(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const input = options.input || process.stdin, output = options.output || process.stdout;
  const signals = options.signals || process;
  const emit = options.emit || ((type, fields) => output.write(JSON.stringify({type, ...fields}) + '\n'));
  const prepare = options.prepare || require('./rpc-attachment.cjs').prepare;
  const spawn = options.spawn || spawnProcess, signal = options.signal || signalOwned;
  const graceMs = options.graceMs ?? 300000, pollMs = options.pollMs ?? 2000;
  const preparationAbort = new AbortController();
  let context, attachmentTask, verificationTask, homebrewTask, finishTask, child;
  let attachmentAttempted = false, ready = false, launchAttempted = false, statusBusy = false, claiming = false;
  let finishing = false, closed = false, outputClosed = false, sourceLost = false, failure;
  let application, config, settled = false, running = false, cleanupBlocked = false, stopRequested = false;
  let awaitingGame = false, gameTitles = new Set(), monitor, stopTimer;
  let resolveDone;
  const done = new Promise(resolve => {resolveDone = resolve;});
  function safeEmit(type, fields = {}) {
    if (outputClosed) return;
    try {emit(type, fields);} catch (error) {
      outputClosed = true;
      if (error.code !== 'EPIPE') failure ||= 'The app event connection failed.';
      void finish('The app connection closed.');
    }
  }
  function fail(message, uncertain = false) {
    failure ||= message;
    if (uncertain && !cleanupBlocked) {
      cleanupBlocked = true;
      safeEmit('cleanup-blocked', {path: context?.directory, resourcesRetained: true,
        message: message + ' The original host and native resources were retained; restart the console before another app attempt.'});
    }
  }
  function stopHomebrew(force = false) {
    if (!child) return;
    if (force || cleanupBlocked || sourceLost) {signal(child, 'SIGKILL', true); return;}
    if (!settled && !stopRequested) {stopRequested = true; signal(child, 'SIGTERM', false);}
    stopTimer ||= setTimeout(() => {
      fail('The selected app did not confirm shutdown.', true);
      signal(child, 'SIGKILL', true);
    }, graceMs);
    stopTimer.unref?.();
  }
  function finish(reason = 'Detaching from the held session.') {
    if (finishing) return finishTask || done;
    finishing = true; ready = false; clearInterval(monitor);
    preparationAbort.abort();
    if (!child) context?.abortVerification?.();
    finishTask = (async () => {
      safeEmit('rpc-finishing', {message: reason + ' Stopping this app’s helpers; the original host remains open.'});
      await attachmentTask?.catch(() => {});
      stopHomebrew();
      await homebrewTask?.catch(() => {});
      context?.abortVerification?.();
      await verificationTask?.catch(() => {});
      if (context) {
        try {await context.close();} catch (error) {fail('Could not close the attachment authorization: ' + error.message);}
      }
      closed = true;
      if (failure) safeEmit('failed', {path: context?.directory, cleanupBlocked, resourcesRetained: true, message: failure});
      safeEmit('rpc-detached', {path: context?.directory, sourceSession: context?.sourceSession,
        cleanupBlocked, resourcesRetained: true,
        message: cleanupBlocked ? 'Detached. The original host and uncertain native resources remain held. Restart the console.' :
          'Detached. The original RPC host and its held resources remain open.'});
      resolveDone(failure ? 1 : 0);
    })().catch(error => {
      fail('Attachment shutdown failed: ' + error.message, Boolean(child));
      if (child) {try {signal(child, 'SIGKILL', true);} catch {}}
      safeEmit('failed', {cleanupBlocked, resourcesRetained: true, message: failure});
      closed = true; resolveDone(1);
    });
    return finishTask;
  }
  async function verify() {
    if (!context) throw Error('No verified attachment is available.');
    if (verificationTask) return verificationTask;
    verificationTask = Promise.resolve().then(() => context.verify()).then(status => {
      if (status?.ready === false) throw Error('The original RPC session is no longer ready.');
      return status;
    });
    try {return await verificationTask;} finally {verificationTask = undefined;}
  }
  function lost(error) {
    if (sourceLost || closed || finishing) return;
    sourceLost = true;
    fail('The original RPC session was lost: ' + error.message, Boolean(child));
    stopHomebrew(true);
    void finish('The source connection ended.');
  }
  function monitorSource() {
    if (finishing || closed || !ready || verificationTask || claiming) return;
    void verify().catch(lost);
  }
  function protocolFailure(message) {
    fail(message);
    stopHomebrew();
  }
  async function homebrew(selection) {
    ({application, config} = selection);
    claiming = true;
    try {
      try {await verify();} catch (error) {lost(error); return;}
      if (finishing) return;
      // Claim in the original run before any helper can issue a native request.
      // Do not poll while this operation installs its ownership marker.
      await context.claimApplication(application);
    } finally {claiming = false;}
    if (finishing) return;
    const configurable = application === 'stremio' || application === 'ouncecake';
    child = spawn(process.execPath, [path.join(root, selection.script), context.directory,
      ...(application === 'stremio' ? ['--quality', selection.quality] : [])], {
      cwd: root, detached: true, stdio: [configurable ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: {...process.env, MAC2JB_ATTACHED_RUN_MANIFEST: context.manifestPath}
    });
    const owned = child;
    const outcomeTask = new Promise(resolve => {
      owned.once('error', error => resolve({error}));
      owned.once('close', (code, exitSignal) => resolve({code, signal: exitSignal}));
    });
    const observe = line => {
      if (!line.startsWith('MAC2JB_HOMEBREW ')) {safeEmit('log', {message: line}); return;}
      let event;
      try {event = JSON.parse(line.slice('MAC2JB_HOMEBREW '.length));}
      catch {protocolFailure('The selected app returned an invalid event.'); return;}
      if (!event || typeof event !== 'object' || Array.isArray(event)) {protocolFailure('The selected app returned an invalid event.'); return;}
      if (sourceLost || closed) return;
      if (event.type === 'account-progress') {
        if (application === 'stremio' && event.watchProgress && typeof event.watchProgress === 'object' && !Array.isArray(event.watchProgress))
          safeEmit('account-progress', {watchProgress: event.watchProgress});
        return;
      }
      if (event.type === 'catalog') {
        if (application !== 'ouncecake' || gameTitles.size || awaitingGame || running || settled || finishing || !validCatalog(event.games)) {
          protocolFailure('OunceCake returned an invalid game list.'); return;
        }
        gameTitles = new Set(event.games.map(game => game.titleId)); awaitingGame = true;
        safeEmit('homebrew-catalog', {games: event.games, path: context.directory, message: event.message}); return;
      }
      if (!['started', 'progress', 'running', 'stopped', 'failed'].includes(event.type)) return;
      if (settled) {protocolFailure('The selected app sent activity after shutdown.'); return;}
      if (application === 'ouncecake' && event.type === 'running' &&
          (awaitingGame || gameTitles.size === 0 || event.host !== config.consoleAddress || event.port !== 2121 ||
           event.ftpURL !== `ftp://${config.consoleAddress}:2121`)) {
        protocolFailure('OunceCake did not confirm the selected FTP endpoint.'); return;
      }
      if (event.cleanupBlocked === true) fail('The selected app could not confirm native shutdown.', true);
      if (event.type === 'running') running = true;
      if (event.type === 'stopped' || event.type === 'failed') {running = false; settled = true;}
      if (event.type === 'failed') fail(event.message || 'The selected homebrew app failed.');
      safeEmit('homebrew-' + event.type, {path: context.directory, message: event.message,
        ...(['izlauncher','stremio'].includes(application) ? {cleanupBlocked} : {}),
        ...(application === 'ouncecake' ? {host: event.host, port: event.port, ftpURL: event.ftpURL, cleanupBlocked} : {})});
    };
    lines(owned.stdout, observe, 1024 * 1024); lines(owned.stderr, observe);
    if (configurable) {
      owned.stdin.on('error', () => protocolFailure('Could not configure the selected app.'));
      try {
        owned.stdin.write(JSON.stringify(config) + '\n');
        if (application === 'stremio') owned.stdin.end();
      } catch {protocolFailure('Could not configure the selected app.');}
    }
    const outcome = await outcomeTask;
    clearTimeout(stopTimer); stopTimer = undefined;
    child = undefined; running = false; awaitingGame = false;
    if (outcome.error || outcome.code !== 0 || outcome.signal || !settled) {
      fail('The selected app failed or did not confirm shutdown. This launch was not retried.', !settled || Boolean(outcome.signal));
      safeEmit('homebrew-failed', {path: context.directory, cleanupBlocked, message: failure});
    }
  }
  async function control(line) {
    let command;
    try {command = JSON.parse(line);} catch {safeEmit('action-rejected', {message: 'Invalid attachment action.'}); return;}
    if (!command || typeof command !== 'object' || Array.isArray(command)) {safeEmit('action-rejected', {message: 'Invalid attachment action.'}); return;}
    if (closed || finishing) {safeEmit('action-rejected', {message: 'The attachment is closing.'}); return;}
    if (command.action === 'finish') {void finish(); return;}
    if (command.action === 'attach') {
      if (attachmentAttempted) {safeEmit('action-rejected', {message: 'Attach only once in this session.'}); return;}
      if (!command.connection || command.connection.kind !== 'local') {
        safeEmit('action-rejected', {message: 'Choose an existing RPC run folder on this Mac.'}); return;
      }
      attachmentAttempted = true;
      attachmentTask = (async () => {
        context = await prepare(root, command.connection, {signal: preparationAbort.signal});
        if (finishing) return;
        await verify();
        if (finishing) return;
        ready = true;
        safeEmit('rpc-attached', {path: context.directory, sourceSession: context.sourceSession,
          message: context.description || 'Attached to the existing held RPC session.'});
        if (pollMs > 0) {monitor = setInterval(monitorSource, pollMs); monitor.unref?.();}
      })().catch(error => {if (!finishing) {fail('Could not attach: ' + error.message); void finish('Attachment verification failed.');}});
      return;
    }
    if (!ready) {safeEmit('action-rejected', {message: 'Attach to a verified open RPC session first.'}); return;}
    if (applications[command.action]) {
      let selection;
      try {selection = launchConfiguration(command);} catch (error) {safeEmit('action-rejected', {message: error.message}); return;}
      if (launchAttempted || statusBusy) {safeEmit('action-rejected', {message: 'Only one homebrew launch attempt is allowed for this held session.'}); return;}
      launchAttempted = true;
      homebrewTask = homebrew(selection).catch(error => {
        if (finishing && !child) return;
        fail('The selected app could not start: ' + error.message, Boolean(child));
        stopHomebrew();
        safeEmit('homebrew-failed', {path: context.directory, cleanupBlocked, message: failure + ' This launch was not retried.'});
      });
      return;
    }
    if (command.action === 'select-ouncecake-game') {
      if (application !== 'ouncecake' || !awaitingGame || !child || settled || cleanupBlocked ||
          typeof command.titleId !== 'string' || !gameTitles.has(command.titleId)) {
        safeEmit('action-rejected', {message: 'Choose one game from this session’s OunceCake list.'}); return;
      }
      awaitingGame = false;
      child.stdin.write(JSON.stringify({action: 'select-game', titleId: command.titleId}) + '\n'); return;
    }
    if (command.action === 'rpc-status') {
      if (statusBusy || launchAttempted) {safeEmit('action-rejected', {message: 'Wait for the current operation to finish.'}); return;}
      statusBusy = true; safeEmit('rpc-status-started', {message: 'Checking the original held RPC connection.'});
      try {
        const status = await verify();
        if (!finishing) safeEmit('rpc-status', {ready: true, calls: status?.calls, message: 'RPC is connected.'});
      } catch (error) {if (!finishing) {safeEmit('rpc-status', {ready: false, message: 'RPC status failed: ' + error.message}); lost(error);}}
      finally {statusBusy = false;}
      return;
    }
    safeEmit('action-rejected', {message: 'Unsupported attachment action.'});
  }
  const stop = () => {void finish('Attachment stopped.');};
  const inputEnd = () => {void finish('The app closed its attachment controls.');};
  const pipeError = error => {outputClosed = true; if (error.code !== 'EPIPE') fail('The app event connection failed.'); void finish('The app connection closed.');};
  const inputError = () => {fail('The app control connection failed.'); void finish();};
  signals.on('SIGTERM', stop); signals.on('SIGINT', stop); output.on('error', pipeError);
  input.on('error', inputError);
  lines(input, line => {void control(line).catch(error => {fail(error.message); void finish();});}, 4 * 1024 * 1024);
  input.once('end', inputEnd); input.resume();
  try {return await done;}
  finally {
    clearInterval(monitor); clearTimeout(stopTimer);
    signals.removeListener('SIGTERM', stop); signals.removeListener('SIGINT', stop);
    input.removeListener('end', inputEnd); input.removeListener('error', inputError); input.pause();
    // Retain the stdout error listener through exit, just like gui-session,
    // so a delayed EPIPE cannot interrupt owned-helper cleanup.
  }
}
module.exports = {main, launchConfiguration, validCatalog};
if (require.main === module) main().then(code => {process.exitCode = code;}).catch(error => {
  try {process.stdout.write(JSON.stringify({type: 'failed', message: error.message, resourcesRetained: true}) + '\n');} catch {}
  process.exitCode = 1;
});
