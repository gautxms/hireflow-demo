import test from 'node:test'
import assert from 'node:assert/strict'
import { ANALYSES_PAGE_SIZE, clampAnalysesPage, paginateAnalyses } from './analysesPaginationState.js'

test('paginateAnalyses slices to max 15 analyses per page', () => {
  const items = Array.from({ length: 32 }, (_, index) => ({ id: index + 1 }))
  const firstPage = paginateAnalyses(items, 1, ANALYSES_PAGE_SIZE)
  const secondPage = paginateAnalyses(items, 2, ANALYSES_PAGE_SIZE)
  const thirdPage = paginateAnalyses(items, 3, ANALYSES_PAGE_SIZE)

  assert.equal(firstPage.rows.length, 15)
  assert.equal(secondPage.rows.length, 15)
  assert.equal(thirdPage.rows.length, 2)
  assert.equal(firstPage.pagination.totalPages, 3)
})

test('pagination controls are hidden when 15 or fewer analyses exist', () => {
  assert.equal(paginateAnalyses(Array.from({ length: 15 }), 1).pagination.shouldRenderControls, false)
  assert.equal(paginateAnalyses(Array.from({ length: 16 }), 1).pagination.shouldRenderControls, true)
})

test('clampAnalysesPage keeps navigation stable when page is out of range', () => {
  assert.equal(clampAnalysesPage(3, 7, ANALYSES_PAGE_SIZE), 1)
  assert.equal(clampAnalysesPage(0, 40, ANALYSES_PAGE_SIZE), 1)
  assert.equal(clampAnalysesPage(2, 40, ANALYSES_PAGE_SIZE), 2)
})
