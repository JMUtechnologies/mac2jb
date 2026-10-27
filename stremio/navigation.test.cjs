'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildNavigation, hitTestNavigation, pageStart} = require('./navigation.cjs');

const center = target => ({x: target.x + target.width / 2, y: target.y + target.height / 2});

test('canonical menu rectangles identify exactly the visible catalog titles and tabs', () => {
  const model = {view: 'catalog', catalog: {index: 10}, tabCount: 15, tabOffset: 7, selectedIndex: 10,
    offset: 8, count: 11, cards: [8, 9, 10].map(index => ({index})),
    tabs: Array.from({length: 7}, (_, localIndex) => ({index: localIndex + 7, label: `Catalog ${localIndex + 7}`}))};
  const navigation = buildNavigation(model, {focusArea: 'tabs', tabIndex: 10});
  assert.equal(navigation.tabs.find(tab => tab.focused).index, 10);
  assert.equal(navigation.cards.length, 3);
  for (const target of [...navigation.tabs, ...navigation.cards]) assert.equal(hitTestNavigation(navigation, center(target)).index, target.index);
  for (const target of navigation.cards) {
    assert.equal(hitTestNavigation(navigation, center(target.poster)).index, target.index);
    assert.equal(hitTestNavigation(navigation, center(target.title)).index, target.index);
  }
  assert.equal(navigation.paging.find(target => target.id === 'next').disabled, true);
  assert.equal(navigation.paging.find(target => target.id === 'previous').index, 4);
  assert.equal(navigation.tabPaging.find(target => target.id === 'nextTabs').index, 14);
  assert.equal(pageStart(10, 4), 8);
});

test('visible menu targets never overlap and stay inside Switch coordinates', () => {
  for (const view of ['catalog', 'catalogs', 'details', 'seasons', 'episodes', 'sources']) {
    const navigation = buildNavigation({view, count: 40, offset: 8, selectedIndex: 11,
      rows: Array.from({length: view === 'details' ? 4 : 8}, (_, index) => ({index: index + 8, disabled: index === 1})),
      cards: [8, 9, 10, 11].map(index => ({index})), tabCount: 13, tabOffset: 0,
      tabs: Array.from({length: 7}, (_, index) => ({index, label: 'A long catalog name '.repeat(20)}))});
    const targets = ['sidebar', 'commands', 'tabPaging', 'tabs', 'cards', 'rows', 'paging'].flatMap(key => navigation[key]);
    for (const [index, target] of targets.entries()) {
      assert.ok(target.x >= 0 && target.y >= 0 && target.x + target.width <= 1280 && target.y + target.height <= 720);
      for (const other of targets.slice(index + 1)) {
        const overlap = target.x < other.x + other.width && target.x + target.width > other.x &&
          target.y < other.y + other.height && target.y + target.height > other.y;
        assert.equal(overlap, false, `${view}: ${target.id || target.index} overlaps ${other.id || other.index}`);
      }
    }
    assert.deepEqual(navigation.sidebar.map(target => target.label), ['Home', 'Library', 'Catalogs']);
    assert.ok(navigation.tabs.every(tab => tab.label.length <= 120));
  }
});

test('hit testing respects disabled rows, exclusive edges and invalid touch input', () => {
  const navigation = buildNavigation({view: 'sources', selectedIndex: 9, offset: 8, count: 12,
    rows: [{index: 8, disabled: true}, {index: 9}]});
  assert.equal(hitTestNavigation(navigation, center(navigation.rows[0])).disabled, true);
  assert.equal(hitTestNavigation(navigation, center(navigation.rows[1])).index, 9);
  const row = navigation.rows[0];
  assert.equal(hitTestNavigation(navigation, {x: row.x + row.width, y: row.y}), null);
  for (const point of [null, {}, {x: NaN, y: 0}, {x: 0, y: Infinity}, {x: -1, y: 10}, {x: 1280, y: 0}, {x: 0, y: 720}])
    assert.equal(hitTestNavigation(navigation, point), null);
  assert.equal(buildNavigation({view: 'playing'}).sidebar.length, 0);
});

test('four detail actions share compact drawing and touch geometry above the notice area', () => {
  const navigation = buildNavigation({view: 'details', selectedIndex: 2,
    rows: ['resume', 'currentSeason', 'watch', 'back'].map((action, index) => ({action, index}))});
  assert.deepEqual(navigation.actions.map(row => [row.x, row.y, row.width, row.height]),
    [[428, 390, 816, 46], [428, 444, 816, 46], [428, 498, 816, 46], [428, 552, 816, 46]]);
  assert.ok(navigation.actions.every(row => row.y + row.height <= 606));
  for (const row of navigation.actions) assert.equal(hitTestNavigation(navigation, center(row)).index, row.index);
  assert.equal(navigation.actions[2].focused, true);
});
