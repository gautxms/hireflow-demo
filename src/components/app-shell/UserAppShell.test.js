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
    assert.match(markup, /Pro/)
  })
})
