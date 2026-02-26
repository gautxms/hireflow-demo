import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

function isDummyStripeKey(key) {
  if (!key) {
    return true;
  }

  const normalized = key.toLowerCase();

  if (
    normalized.includes('dummy') ||
    normalized.includes('example') ||
    normalized.includes('changeme') ||
    normalized.includes('your_')
  ) {
    return true;
  }

  return !/^sk_(test|live)_[a-zA-Z0-9]+$/.test(key);
}

let stripe = null;

if (isDummyStripeKey(secretKey)) {
  console.info('[stripe] disabled: STRIPE_SECRET_KEY is missing or not a real Stripe secret key.');
} else {
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(secretKey);
    console.info('[stripe] enabled: Stripe client initialized successfully.');
  } catch (error) {
    stripe = null;
    console.warn('[stripe] disabled: failed to initialize Stripe client.', error.message);
  }
}

export { stripe };
export default stripe;
