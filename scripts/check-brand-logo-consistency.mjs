import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function fail(message) {
  console.error(`❌ ${message}`)
  process.exitCode = 1
}

function getRuleBody(css, selectorGroup) {
  const escaped = selectorGroup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\s*')
  const ruleRegex = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm')
  const match = css.match(ruleRegex)
  return match?.[1] ?? ''
}

function getDeclaration(body, prop) {
  const regex = new RegExp(`${prop}\\s*:\\s*([^;]+);`)
  return body.match(regex)?.[1]?.trim() ?? null
}

const appFile = read('src/App.jsx')
const footerFile = read('src/components/PublicFooter.jsx')
const brandLogoComponentFile = read('src/components/BrandLogo.jsx')
const loginPageFile = read('src/components/LoginPage.jsx')
const signupPageFile = read('src/components/SignupPage.jsx')
const css = read('src/globals.css')

if (!appFile.includes('className="site-header__logo"') || !appFile.includes('<BrandLogo')) {
  fail('Header logo is missing expected `.site-header__logo` usage with the shared `BrandLogo` component.')
}

if (!brandLogoComponentFile.includes('Hire<span>Flow</span>')) {
  fail('Shared `BrandLogo` component must render `Hire<span>Flow</span>`.')
}

if (!footerFile.includes('className="public-footer__brand"') || !footerFile.includes('Hire<span>Flow</span>')) {
  fail('Footer logo is missing expected `.public-footer__brand` structure with `Hire<span>Flow</span>`.')
}

if (!loginPageFile.includes('className="auth-brand"') || !signupPageFile.includes('className="auth-brand"')) {
  fail('Auth pages must render the shared logo class `auth-brand`.')
}

const sharedLogoRule = getRuleBody(css, '.brand-logo,\n.site-header__logo,\n.public-footer__brand')
if (!sharedLogoRule) {
  fail('Missing shared CSS rule for `.brand-logo`, `.site-header__logo`, and `.public-footer__brand`.')
} else {
  const family = getDeclaration(sharedLogoRule, 'font-family')
  const weight = getDeclaration(sharedLogoRule, 'font-weight')
  const letterSpacing = getDeclaration(sharedLogoRule, 'letter-spacing')

  if (!family || !family.includes('var(--font-family-brand-display)')) {
    fail('Logo font-family must use `var(--font-family-brand-display)`.')
  }

  if (!weight) {
    fail('Header/footer logo shared rule must define `font-weight`.')
  }

  if (!letterSpacing || letterSpacing !== '-0.03em') {
    fail('Logo shared rule must define `letter-spacing: -0.03em`.')
  }
}

const sharedSpanRule = getRuleBody(css, '.brand-logo span,\n.site-header__logo span,\n.public-footer__brand span')
if (!sharedSpanRule) {
  fail('Missing shared CSS rule for brand/logo split color span.')
} else {
  const color = getDeclaration(sharedSpanRule, 'color')
  if (!color || !color.includes('var(--color-accent-green)')) {
    fail('Header/footer logo span must use shared accent color `var(--color-accent-green)`.')
  }
}

if (!process.exitCode) {
  console.log('✅ Brand logo consistency checks passed for header/footer.')
}
