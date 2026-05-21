#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function read(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const dashboardSource = read('src/components/NewDashboard.jsx')
const dashboardStyles = read('src/components/NewDashboard.css')
const shellSource = read('src/components/app-shell/UserAppShell.jsx')
const shellStyles = read('src/globals.css')

const firstSelectIndex = dashboardSource.indexOf('className="new-dashboard__select"')
const secondSelectIndex = dashboardSource.indexOf('className="new-dashboard__select"', firstSelectIndex + 1)
const applyButtonIndex = dashboardSource.indexOf('new-dashboard__button--primary')
const exportButtonIndex = dashboardSource.indexOf('new-dashboard__button--secondary')
assert(firstSelectIndex > -1 && secondSelectIndex > firstSelectIndex, 'Dashboard filter selects are missing from top controls.')
assert(applyButtonIndex > secondSelectIndex, 'Apply filters button should come after filter controls in tab order.')
assert(exportButtonIndex > applyButtonIndex, 'Export action should come after apply action in tab order.')

assert(/\.new-dashboard__button--primary:focus-visible,[\s\S]*\.new-dashboard__button--secondary:focus-visible/.test(dashboardStyles), 'Dashboard action buttons are missing focus-visible styles.')
assert(/\.new-dashboard__select:focus-visible/.test(dashboardStyles), 'Dashboard filter selects are missing focus-visible styles.')
assert(/\.new-dashboard__bar-column:focus-visible/.test(dashboardStyles), 'Dashboard chart bar controls are missing focus-visible styles.')
assert(/\.app-sb-item:focus-visible/.test(shellStyles), 'Sidebar navigation focus-visible style is missing.')
assert(/\.app-sb-chevron[\s\S]*\.app-sb-pin[\s\S]*:focus-visible|\.app-sb-pin,[\s\S]*\.app-sb-chevron,[\s\S]*outline/.test(shellStyles), 'Sidebar footer controls are missing focus-visible coverage.')

assert(/className="app-sb-chevron"[\s\S]*aria-label=\{expanded \? 'Collapse sidebar' : 'Expand sidebar'\}/.test(shellSource), 'Sidebar chevron icon button requires a screen-reader aria-label.')

console.log('✅ Dashboard accessibility smoke checks passed (tab order, focus-visible, icon-label guards).')
