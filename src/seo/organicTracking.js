import { INTENT_PAGE_ORDER } from '../pages/seo/intentPages'
import { trackEvent } from '../privacy/analytics'

const SEARCH_ENGINES = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'baidu.', 'yandex.']

function getAcquisitionContext() {
  const url = new URL(window.location.href)
  const source = url.searchParams.get('utm_source') || ''
  const medium = url.searchParams.get('utm_medium') || ''
  const campaign = url.searchParams.get('utm_campaign') || ''
  const referrer = document.referrer || ''
  const organicReferrer = SEARCH_ENGINES.some((engine) => referrer.includes(engine))

  return {
    source: source || (organicReferrer ? 'search-engine' : 'direct'),
    medium: medium || (organicReferrer ? 'organic' : 'none'),
    campaign: campaign || 'not_set',
    referrer,
    isOrganic: organicReferrer || medium.toLowerCase() === 'organic',
  }
}

export function trackIntentLanding(pathname) {
  if (!INTENT_PAGE_ORDER.includes(pathname)) {
    return false
  }

  const context = getAcquisitionContext()

  return trackEvent('intent_landing_view', {
    page_path: pathname,
    page_title: document.title,
    landing_route: pathname,
    traffic_source: context.source,
    traffic_medium: context.medium,
    traffic_campaign: context.campaign,
    is_organic: context.isOrganic,
  })
}
