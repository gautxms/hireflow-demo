const PLAN_CHANGE_METADATA_KEY = 'hireflowPlanChange'

function dataFromPayload(payload = {}) {
  return payload?.data || payload || {}
}

function dateValue(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

export function normalizePaddleSubscriptionItems(items = []) {
  if (!Array.isArray(items)) return []

  return items
    .map((item) => {
      const priceId = item?.price?.id || item?.price_id || item?.priceId || null
      if (!priceId) return null
      return {
        price_id: priceId,
        quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 1,
      }
    })
    .filter(Boolean)
}

export function buildPlanChangeCustomData(existingCustomData = {}, context = {}) {
  return {
    ...(existingCustomData || {}),
    plan: context.toPlan,
    [PLAN_CHANGE_METADATA_KEY]: compactObject({
      fromPlan: context.fromPlan,
      toPlan: context.toPlan,
      priorStatus: context.priorStatus,
      priorCurrentPeriodEnd: dateValue(context.priorCurrentPeriodEnd),
      priorNextBillingDate: dateValue(context.priorNextBillingDate),
      priorRenewalDate: dateValue(context.priorRenewalDate),
      previousItems: normalizePaddleSubscriptionItems(context.previousItems),
      startedAt: dateValue(context.startedAt || new Date()),
      outcome: context.outcome || 'pending',
    }),
  }
}

export function getPlanChangeMetadata(payload = {}) {
  const data = dataFromPayload(payload)
  const customData = data?.custom_data || payload?.custom_data || {}
  const metadata = customData?.[PLAN_CHANGE_METADATA_KEY]

  if (!metadata || typeof metadata !== 'object') return null

  const fromPlan = metadata.fromPlan === 'annual' ? 'annual' : metadata.fromPlan === 'monthly' ? 'monthly' : null
  const toPlan = metadata.toPlan === 'annual' ? 'annual' : metadata.toPlan === 'monthly' ? 'monthly' : null
  if (!fromPlan || !toPlan || fromPlan === toPlan) return null

  return {
    fromPlan,
    toPlan,
    priorStatus: String(metadata.priorStatus || '').toLowerCase() || null,
    priorCurrentPeriodEnd: dateValue(metadata.priorCurrentPeriodEnd),
    priorNextBillingDate: dateValue(metadata.priorNextBillingDate),
    priorRenewalDate: dateValue(metadata.priorRenewalDate),
    previousItems: normalizePaddleSubscriptionItems(metadata.previousItems),
    startedAt: dateValue(metadata.startedAt),
    outcome: String(metadata.outcome || '').toLowerCase() || null,
  }
}

export function getPaddleTransactionOrigin(payload = {}) {
  return String(dataFromPayload(payload)?.origin || payload?.origin || '').toLowerCase()
}

export function isSubscriptionUpdateTransaction(payload = {}) {
  return getPaddleTransactionOrigin(payload) === 'subscription_update'
}

function getPriceIdsForPlan(paddle, plan) {
  return new Set([
    paddle?.priceIdsByPlan?.[plan],
    paddle?.noTrialPriceIdsByPlan?.[plan],
    paddle?.testUpgrade?.[`${plan}PriceId`],
    ...(paddle?.legacyPriceIdsByPlan?.[plan] || []),
  ].filter(Boolean))
}

export function inferPlanFromPaddlePayload(payload = {}, paddle = {}) {
  const data = dataFromPayload(payload)
  const items = Array.isArray(data?.items) ? data.items : []
  const monthlyIds = getPriceIdsForPlan(paddle, 'monthly')
  const annualIds = getPriceIdsForPlan(paddle, 'annual')

  for (const item of items) {
    const priceId = item?.price?.id || item?.price_id || item?.priceId || null
    if (monthlyIds.has(priceId)) return 'monthly'
    if (annualIds.has(priceId)) return 'annual'
  }

  const customPlan = data?.custom_data?.plan || payload?.custom_data?.plan || null
  if (customPlan === 'test-monthly') return 'monthly'
  return customPlan === 'monthly' || customPlan === 'annual' ? customPlan : null
}

function transactionMatchesPlanChange(transaction, metadata, startedAt) {
  if (String(transaction?.origin || '').toLowerCase() !== 'subscription_update') return false

  const transactionMetadata = getPlanChangeMetadata(transaction)
  if (transactionMetadata) {
    return transactionMetadata.fromPlan === metadata.fromPlan && transactionMetadata.toPlan === metadata.toPlan
  }

  if (!startedAt || !transaction?.created_at) return true
  return new Date(transaction.created_at).getTime() >= new Date(startedAt).getTime() - (5 * 60 * 1000)
}

function sameSubscriptionItems(left = [], right = []) {
  const canonical = (items) => normalizePaddleSubscriptionItems(items)
    .map((item) => `${item.price_id}:${item.quantity}`)
    .sort()
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

async function findFailedUpdateTransactions(request, subscriptionId, metadata) {
  const query = new URLSearchParams({
    subscription_id: subscriptionId,
    status: 'past_due',
    origin: 'subscription_update',
    per_page: '30',
  })
  const payload = await request(`/transactions?${query.toString()}`)
  const transactions = Array.isArray(payload?.data) ? payload.data : []
  return transactions.filter((transaction) => transactionMatchesPlanChange(transaction, metadata, metadata.startedAt))
}

export async function recoverFailedPaddlePlanChange({
  request,
  subscriptionId,
  transactionId = null,
  metadata,
  existingCustomData = {},
}) {
  if (typeof request !== 'function') throw new Error('Paddle request function is required')
  if (!subscriptionId) throw new Error('Paddle subscription ID is required')
  if (!metadata?.fromPlan || !metadata?.toPlan) throw new Error('Plan change recovery metadata is required')
  if (!Array.isArray(metadata.previousItems) || metadata.previousItems.length === 0) {
    throw new Error('Original subscription items are required for plan change recovery')
  }

  const failedTransactions = transactionId
    ? [{ id: transactionId }]
    : await findFailedUpdateTransactions(request, subscriptionId, metadata)

  const cancellationErrors = []
  for (const transaction of failedTransactions) {
    if (!transaction?.id) continue
    try {
      await request(`/transactions/${transaction.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'canceled' }),
      })
    } catch (error) {
      cancellationErrors.push(error)
    }
  }

  const currentPayload = await request(`/subscriptions/${subscriptionId}`)
  const currentData = dataFromPayload(currentPayload)
  const recoveryCustomData = buildPlanChangeCustomData(
    currentData?.custom_data || existingCustomData,
    { ...metadata, outcome: 'recovered' },
  )
  recoveryCustomData.plan = metadata.fromPlan

  const restoredPayload = await request(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      items: metadata.previousItems,
      proration_billing_mode: 'do_not_bill',
      custom_data: recoveryCustomData,
    }),
  })

  const finalPayload = await request(`/subscriptions/${subscriptionId}`)
  const finalStatus = String(dataFromPayload(finalPayload)?.status || '').toLowerCase()
  const finalItems = dataFromPayload(finalPayload)?.items || []

  if (finalStatus === 'past_due') {
    throw cancellationErrors[0] || new Error('Paddle subscription remained past due after plan change recovery')
  }

  if (!sameSubscriptionItems(finalItems, metadata.previousItems)) {
    throw new Error('Paddle subscription items were not restored after plan change recovery')
  }

  if (cancellationErrors.length > 0) {
    throw cancellationErrors[0]
  }

  return {
    restoredPayload,
    finalPayload,
    canceledTransactionIds: failedTransactions.map((transaction) => transaction?.id).filter(Boolean),
  }
}
