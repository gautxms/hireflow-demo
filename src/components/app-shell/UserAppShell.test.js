import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import UserAppShell from './UserAppShell.jsx'

test('UserAppShell renders subscribed dashboard view without explicit pageTitleProp', () => {
  assert.doesNotThrow(() => {
    const markup = renderToStaticMarkup(
      createElement(
        UserAppShell,
        {
          pathname: '/dashboard',
          onNavigate: () => {},
          userProfile: { name: 'Jordan Example' },
          subscriptionStatus: 'active',
        },
        createElement('section', null, 'Dashboard content'),
      ),
    )

    assert.match(markup, /Dashboard/)
    assert.match(markup, /Plan/)
  })
})


test('UserAppShell assigns distinct canonical icons for Shortlists and Reports', () => {
  const readIconName = (navItem) => navItem?.props?.Icon?.displayName || navItem?.props?.Icon?.name

  const tree = UserAppShell({
    pathname: '/dashboard',
    onNavigate: () => {},
    subscriptionStatus: 'active',
    navItems: [
      { label: 'Shortlists', path: '/shortlists', icon: 'shortlists' },
      { label: 'Reports', path: '/reports', icon: 'reports' },
    ],
    children: createElement('div', null, 'content'),
  })

  const aside = tree.props.children[0]
  const nav = aside.props.children[1]
  const navItems = nav.props.children

  const shortlistsItem = navItems.find((item) => item.key === '/shortlists')
  const reportsItem = navItems.find((item) => item.key === '/reports')

  assert.equal(readIconName(shortlistsItem), 'ClipboardCheck')
  assert.equal(readIconName(reportsItem), 'BarChart3')
  assert.notEqual(shortlistsItem.props.Icon, reportsItem.props.Icon)
})
