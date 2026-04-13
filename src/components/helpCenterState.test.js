import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterHelpArticles,
  parseHelpCenterLocation,
  resolveVisibleSelection,
} from './helpCenterState.js'

const articles = {
  alpha: [
    { id: 1, title: 'Start Here', desc: 'Intro' },
    { id: 2, title: 'Second', desc: 'Another' },
  ],
  beta: [
    { id: 3, title: 'Billing Guide', desc: 'Manage invoices' },
  ],
}

test('parseHelpCenterLocation selects the category containing the requested article', () => {
  const state = parseHelpCenterLocation(articles, 'alpha', 'https://app.local/help?helpArticle=3')

  assert.deepEqual(state, {
    activeCategory: 'beta',
    selectedArticleId: 3,
  })
})

test('parseHelpCenterLocation falls back for unknown article id', () => {
  const state = parseHelpCenterLocation(articles, 'alpha', 'https://app.local/help?helpArticle=999')
  assert.deepEqual(state, {
    activeCategory: 'alpha',
    selectedArticleId: null,
  })
})

test('filterHelpArticles + resolveVisibleSelection clear stale selection', () => {
  const visible = filterHelpArticles(articles.alpha, 'start')
  assert.equal(resolveVisibleSelection(2, visible), null)
  assert.equal(resolveVisibleSelection(1, visible), 1)
})
