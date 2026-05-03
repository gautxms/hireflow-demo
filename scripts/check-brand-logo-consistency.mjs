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
const css = read('src/globals.css')

if (!appFile.includes('className="site-header__logo"') || !appFile.includes('Hire<span>Flow</span>')) {
  fail('Header logo is missing expected `.site-header__logo` structure with `Hire<span>Flow</span>`.')
}

if (!footerFile.includes('className="public-footer__brand"') || !footerFile.includes('Hire<span>Flow</span>')) {
  fail('Footer logo is missing expected `.public-footer__brand` structure with `Hire<span>Flow</span>`.')
}

const sharedLogoRule = getRuleBody(css, '.site-header__logo,\n.public-footer__brand')
if (!sharedLogoRule) {
  fail('Missing shared CSS rule for `.site-header__logo` and `.public-footer__brand`.')
} else {
  const family = getDeclaration(sharedLogoRule, 'font-family')
  const weight = getDeclaration(sharedLogoRule, 'font-weight')

  if (!family || !family.toLowerCase().includes('syne')) {
    fail('Header/footer logo font-family must include `Syne`.')
  }

  if (!weight) {
    fail('Header/footer logo shared rule must define `font-weight`.')
  }
}

const sharedSpanRule = getRuleBody(css, '.site-header__logo span,\n.public-footer__brand span')
if (!sharedSpanRule) {
  fail('Missing shared CSS rule for header/footer logo split color span.')
} else {
  const color = getDeclaration(sharedSpanRule, 'color')
  if (!color || !color.includes('var(--color-accent-green)')) {
    fail('Header/footer logo span must use shared accent color `var(--color-accent-green)`.')
  }
}

if (!process.exitCode) {
  console.log('✅ Brand logo consistency checks passed for header/footer.')
}
