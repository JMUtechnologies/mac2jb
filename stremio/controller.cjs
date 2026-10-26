'use strict';
const {AddonCollection, clean, redactText} = require('./addons.cjs');
const {renderMenu} = require('./menu.cjs');
const library = require('./library.cjs');
const BUTTONS = new Set(['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y']);
const time = seconds => `${Math.floor(Math.max(0, seconds || 0) / 60)}:${String(Math.floor(Math.max(0, seconds || 0) % 60)).padStart(2, '0')}`;
const episodeLabel = video => [video.season === null ? '' : `S${String(video.season).padStart(2, '0')}` +
  (video.episode === null ? '' : `E${String(video.episode).padStart(2, '0')}`), video.title].filter(Boolean).join(' · ');
const hasEpisodes = meta => meta?.type === 'series' || meta?.type !== 'tv' && (meta?.videos.length || 0) > 1;
const videoID = (meta, video) => meta.type === 'tv' ? meta.id : video?.id || meta.behaviorHints?.defaultVideoId || meta.videos[0]?.id || meta.id;

class Controller {
  constructor({addonUrls = [], libraryItems = [], callbacks = {}, onChange = () => {}, onLog = () => {}, ...networkOptions} = {}) {
    this.callbacks = callbacks; this.onChange = onChange; this.onLog = onLog;
    this.abort = new AbortController(); this.closed = false;
    this.addons = new AddonCollection({addonUrls, ...networkOptions, signal: this.abort.signal, onLog: value => this._log(value)});
    this.catalogs = []; this.catalogIndex = 0; this.catalogItems = [];
    this.libraryItems = library.normalizeLibrary(libraryItems); this.libraryItem = null;
    this.meta = null; this.video = null; this.streams = [];
    this.view = 'catalog'; this.selected = 0; this.catalogSelected = 0;
    this.episodeSelected = 0; this.sourceSelected = 0;
    this.busy = false; this.notice = ''; this.loading = '';
    this.playback = {paused: false, position: 0, duration: 0, volume: 1};
    this.playTitle = '';
    this.playGeneration = 0; this.playStarting = false;
  }

  _log(message) { if (this.closed) return; try { this.onLog(redactText(message)); } catch {} }
  _emit() {
    if (this.closed) return;
    try {
      const promise = this.onChange(this.getMenuModel());
      if (promise?.catch) promise.catch(() => this._log('The menu update callback failed.'));
    } catch { this._log('The menu update callback failed.'); }
  }
  async _operation(label, action) {
    if (this.busy || this.closed) return false;
    this.busy = true; this.loading = label; this.notice = ''; this._emit();
    try { await action(); return true; }
    catch (error) { this.notice = redactText(error.message || 'The action could not finish.'); this._log(this.notice); return false; }
    finally { this.busy = false; this.loading = ''; this._emit(); }
  }

  async init() {
    return this._operation('Loading addons…', async () => {
      let addonError;
      try { await this.addons.init(); } catch (error) { if (!this.libraryItems.length) throw error; addonError = error; }
      this.catalogs = this._libraryCatalogs().concat(this.addons.catalogs());
      if (!this.catalogs.length) throw Error('The configured addons do not provide any catalogs.');
      await this._loadCatalog(0);
      if (addonError || this.addons.errors.length) this.notice = 'Some addons are unavailable. Library entries remain available; their sources require a working addon.';
    });
  }

  _libraryCatalogs() {
    if (!this.libraryItems.length) return [];
    const catalogs = [{kind: 'library', name: 'My Library', addonName: 'Stremio account'}];
    if (this.libraryItems.some(library.inContinue)) catalogs.unshift({kind: 'continue', name: 'Continue watching', addonName: 'Stremio account'});
    return catalogs;
  }

  _libraryRows(kind) {
    return this.libraryItems.filter(item => kind === 'continue' ? library.inContinue(item) : !item.removed && !item.temp)
      .sort((a, b) => (Date.parse(b.state.lastWatched || b._mtime) || 0) - (Date.parse(a.state.lastWatched || a._mtime) || 0))
      .map(library.libraryMeta).filter(Boolean);
  }

  async _loadCatalog(index) {
    const normalized = (index + this.catalogs.length) % this.catalogs.length;
    const catalog = this.catalogs[normalized];
    const items = catalog.kind ? this._libraryRows(catalog.kind) : await catalog.client.catalog(catalog);
    this.catalogIndex = normalized; this.catalogItems = items;
    this.view = 'catalog'; this.selected = 0; this.catalogSelected = 0;
    this.meta = null; this.video = null; this.streams = []; this.libraryItem = null;
    if (!items.length) this.notice = 'This catalog is empty.';
  }

  async _openMeta(item) {
    const catalog = this.catalogs[this.catalogIndex];
    this.libraryItem = this.libraryItems.find(entry => entry._id === item.id) || null;
    const fetched = await this.addons.meta(item.type, item.id, catalog.client);
    this.meta = fetched ? {...item, ...fetched, poster: fetched.poster || item.poster} : item;
    this.video = null; this.view = 'details'; this.selected = 0;
  }

  _detailsActions() {
    const actions = [];
    if (this.libraryItem && library.inContinue(this.libraryItem)) {
      const id = this.libraryItem.state.video_id || (this.meta.type !== 'series' ? videoID(this.meta) : null);
      if (id) actions.push({action: 'resume', id, label: `Resume at ${time(library.resumePosition(this.libraryItem, id))}`,
        detail: this.meta.type === 'series' ? this.meta.videos.find(video => video.id === id)?.title || id : ''});
    }
    const episodes = hasEpisodes(this.meta);
    actions.push({action: 'watch', label: episodes ? `Episodes (${this.meta.videos.length})` : 'Choose a stream',
      detail: episodes && !this.meta.videos.length ? 'No episode list provided' : ''});
    actions.push({action: 'back', label: 'Back to catalog'});
    return actions;
  }

  async _openStreams(video = null) {
    const id = videoID(this.meta, video);
    const streams = await this.addons.streams(this.meta.type, id);
    this.video = video; this.streams = streams;
    this.view = 'sources'; this.selected = 0; this.sourceSelected = 0;
    if (!streams.length) this.notice = 'No sources were returned for this video.';
  }

  _rows() {
    if (this.view === 'catalogs') return this.catalogs.map(catalog => ({label: catalog.name, detail: catalog.addonName}));
    if (this.view === 'catalog') return this.catalogItems.map(meta => ({label: meta.name,
      detail: [meta.releaseInfo, meta.type].filter(Boolean).join(' · ')}));
    if (this.view === 'details') return this._detailsActions();
    if (this.view === 'episodes') return this.meta.videos.map(video => ({label: episodeLabel(video), detail: video.released.slice(0, 10)}));
    if (this.view === 'sources') return this.streams.map(stream => ({label: stream.label,
      detail: stream.playable ? stream.addonName : 'Unsupported source', disabled: !stream.playable}));
    return [];
  }

  getMenuModel() {
    const rows = this._rows();
    const selected = Math.max(0, Math.min(this.selected, Math.max(0, rows.length - 1)));
    const start = Math.max(0, Math.min(selected - 3, rows.length - 8));
    let title = 'Stremio compatible · alpha', subtitle = '';
    if (this.view === 'catalogs') subtitle = 'Choose a catalog';
    if (this.view === 'catalog') {
      const catalog = this.catalogs[this.catalogIndex];
      subtitle = catalog ? `${catalog.addonName} · ${catalog.name}` : 'Catalogs';
    }
    if (this.view === 'details' || this.view === 'episodes') {
      title = this.meta?.name || title;
      subtitle = this.view === 'episodes' ? 'Choose an episode' : [this.meta?.releaseInfo, this.meta?.type].filter(Boolean).join(' · ');
    }
    if (this.view === 'sources') { title = this.video ? episodeLabel(this.video) : this.meta?.name || title; subtitle = 'Choose a source'; }
    if (this.view === 'playing') {
      title = this.playTitle;
      subtitle = `${this.playback.paused ? 'Paused' : 'Playing'} · ${time(this.playback.position)} / ${time(this.playback.duration)} · ${Math.round(this.playback.volume * 100)}%`;
    }
    return {width: 320, height: 180, view: this.view, title, subtitle,
      rows: rows.slice(start, start + 8), selected: selected - start, offset: start, count: rows.length,
      description: this.view === 'details' ? this.meta?.description || '' : '',
      message: this.busy ? this.loading : this.notice, busy: this.busy, isPlaying: this.view === 'playing',
      footer: this.view === 'playing' ? 'A Pause  B Stop  ←/→ Seek  ↑/↓ Vol' : 'A Select  B Back  X Refresh  Y Catalog'};
  }

  async _select() {
    if (this.view === 'catalogs') { await this._loadCatalog(this.selected); return; }
    if (this.view === 'catalog') {
      const item = this.catalogItems[this.selected];
      if (item) { this.catalogSelected = this.selected; await this._openMeta(item); }
      return;
    }
    if (this.view === 'details') {
      const action = this._detailsActions()[this.selected];
      if (action?.action === 'back') { this.view = 'catalog'; this.selected = this.catalogSelected; return; }
      if (action?.action === 'resume') {
        const video = this.meta.videos.find(video => video.id === action.id) ||
          {id: action.id, title: this.meta.name, season: null, episode: null, released: ''};
        await this._openStreams(video); return;
      }
      if (hasEpisodes(this.meta)) {
        if (!this.meta.videos.length) throw Error('This addon does not provide an episode list.');
        this.view = 'episodes'; this.selected = 0;
      } else await this._openStreams();
      return;
    }
    if (this.view === 'episodes') {
      const video = this.meta.videos[this.selected];
      if (video) { this.episodeSelected = this.selected; await this._openStreams(video); }
      return;
    }
    if (this.view === 'sources') {
      const source = this.streams[this.selected];
      if (!source) return;
      if (!source.playable) throw Error(source.reason);
      if (typeof this.callbacks.play !== 'function') throw Error('The media pipeline is not connected.');
      this.playTitle = this.video ? `${this.meta.name} · ${episodeLabel(this.video)}` : this.meta.name;
      this._log(`Starting direct HTTP(S) playback from ${source.addonName}.`);
      const generation = ++this.playGeneration;
      this.sourceSelected = this.selected; this.playStarting = true;
      try {
        const id = videoID(this.meta, this.video);
        const info = {itemId: this.meta.id, videoId: id, type: this.meta.type, name: this.meta.name,
          ...(this.meta.poster ? {poster: this.meta.poster} : {}),
          ...(Number.isSafeInteger(this.video?.season) ? {season: this.video.season} : {}),
          ...(Number.isSafeInteger(this.video?.episode) ? {episode: this.video.episode} : {}),
          ...(this.meta.type === 'series' ? {videoIds: this.meta.videos.map(video => video.id)} : {})};
        const resume = library.resumePosition(this.libraryItem, id);
        this.playback = {paused: false, position: resume,
          duration: this.libraryItem && (this.libraryItem.state.video_id || this.libraryItem._id) === id ? this.libraryItem.state.duration / 1000 : 0,
          volume: this.playback.volume};
        await this.callbacks.play({url: source.url, headers: {...source.headers}, title: this.playTitle,
          meta: {id: this.meta.id, type: this.meta.type, videoId: id}, resumePosition: resume, libraryInfo: info});
      } finally { this.playStarting = false; }
      if (generation !== this.playGeneration) return;
      this.view = 'playing'; this.selected = 0;
    }
  }

  async _back() {
    if (this.view === 'sources') {
      const episodes = hasEpisodes(this.meta);
      this.view = episodes ? 'episodes' : 'details'; this.selected = episodes ? this.episodeSelected : 0;
    } else if (this.view === 'episodes') { this.view = 'details'; this.selected = 0; }
    else if (this.view === 'details') { this.view = 'catalog'; this.selected = this.catalogSelected; }
    else if (this.view === 'catalog') { this.view = 'catalogs'; this.selected = this.catalogIndex; }
  }

  async _refresh() {
    if (this.view === 'catalog' || this.view === 'catalogs') await this._loadCatalog(this.catalogIndex);
    else if (this.view === 'sources') await this._openStreams(this.video);
    else if (this.view === 'details' || this.view === 'episodes') await this._openMeta(this.meta);
  }

  async _playingButton(button) {
    const callback = async (name, ...args) => {
      if (typeof this.callbacks[name] !== 'function') throw Error(`Playback ${name} is not connected.`);
      return this.callbacks[name](...args);
    };
    if (button === 'a') { await callback('pause'); this.playback.paused = !this.playback.paused; }
    if (button === 'left' || button === 'right') {
      const seconds = button === 'right' ? 10 : -10;
      await callback('seek', seconds); this.playback.position = Math.max(0, this.playback.position + seconds);
    }
    if (button === 'up' || button === 'down') {
      const delta = button === 'up' ? 0.05 : -0.05;
      await callback('volume', delta); this.playback.volume = Math.min(1, Math.max(0, this.playback.volume + delta));
    }
    if (button === 'b') {
      await callback('stop'); this._updateLibrarySnapshot(false);
      this.view = 'sources'; this.selected = this.sourceSelected;
    }
  }

  async handleButton(button) {
    if (!BUTTONS.has(button) || this.busy || this.closed) return false;
    if (this.view !== 'playing' && (button === 'up' || button === 'down')) {
      const count = this._rows().length;
      if (count) this.selected = (this.selected + (button === 'down' ? 1 : -1) + count) % count;
      this.notice = ''; this._emit(); return true;
    }
    return this._operation(this.view === 'playing' ? 'Updating playback…' : 'Loading…', async () => {
      if (this.view === 'playing') { await this._playingButton(button); return; }
      if (button === 'a') await this._select();
      else if (button === 'b') await this._back();
      else if (button === 'x') await this._refresh();
      else if (button === 'y' && this.catalogs.length) await this._loadCatalog(this.catalogIndex + 1);
    });
  }

  updatePlayback(update = {}) {
    if (this.closed) return;
    for (const key of ['position', 'duration', 'volume']) if (Number.isFinite(update[key]) &&
      (key === 'volume' || update[key] >= 0 && update[key] <= library.MAX_SECONDS))
      this.playback[key] = key === 'volume' ? Math.max(0, Math.min(1, update[key])) : Math.max(0, update[key]);
    if (typeof update.paused === 'boolean') this.playback.paused = update.paused;
    this._updateLibrarySnapshot(false);
    this._emit();
  }

  _updateLibrarySnapshot(ended) {
    if (!this.meta || this.view !== 'playing' && !this.playStarting) return;
    let item = this.libraryItems.find(entry => entry._id === this.meta.id);
    if (!item) item = library.normalizeLibraryItem({_id: this.meta.id, type: this.meta.type, name: this.meta.name,
      poster: this.meta.poster, removed: true, temp: true, state: {}});
    if (!item) return;
    const updated = library.updateLibraryItem(item, {videoId: videoID(this.meta, this.video),
      position: this.playback.position, duration: this.playback.duration, ended});
    this.libraryItem = updated;
    const index = this.libraryItems.findIndex(entry => entry._id === item._id);
    if (index < 0) this.libraryItems.unshift(updated); else this.libraryItems[index] = updated;
    const currentCatalog = this.catalogs[this.catalogIndex];
    this.catalogs = this._libraryCatalogs().concat(this.catalogs.filter(catalog => !catalog.kind));
    const currentIndex = this.catalogs.findIndex(catalog => currentCatalog?.kind ? catalog.kind === currentCatalog.kind : catalog === currentCatalog);
    this.catalogIndex = currentIndex >= 0 ? currentIndex : 0;
    if (this.catalogs[this.catalogIndex]?.kind) {
      this.catalogItems = this._libraryRows(this.catalogs[this.catalogIndex].kind);
      this.catalogSelected = Math.min(this.catalogSelected, Math.max(0, this.catalogItems.length - 1));
    }
  }

  playbackEnded(message = 'Playback ended.') {
    if (this.closed || this.view !== 'playing' && !this.playStarting) return;
    this._updateLibrarySnapshot(true);
    this.playGeneration++;
    this.view = 'sources'; this.selected = this.sourceSelected;
    this.notice = redactText(message); this._emit();
  }

  playbackFailed(message = 'Playback failed. Check the Mac activity log.') {
    if (this.closed || this.view !== 'playing' && !this.playStarting) return;
    this._updateLibrarySnapshot(false); this.playGeneration++;
    this.view = 'sources'; this.selected = this.sourceSelected;
    this.notice = redactText(message); this._emit();
  }

  setPlaybackInfo(update) { this.updatePlayback(update); }

  close() { this.closed = true; this.playGeneration++; this.abort.abort(); }

  renderMenu(options) { return renderMenu(this.getMenuModel(), options); }
}

const createController = options => new Controller(options);
module.exports = {Controller, createController, renderMenu, episodeLabel};
