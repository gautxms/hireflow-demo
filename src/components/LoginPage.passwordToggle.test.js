import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = readFileSync(new URL('./LoginPage.jsx', import.meta.url), 'utf8')

test('login password field defaults hidden and toggles to visible without changing submit payload', () => {
  assert.match(source, /const \[showPassword, setShowPassword\] = useState\(false\)/)
  assert.match(source, /id="login-password"[\s\S]*type=\{showPassword \? 'text' : 'password'\}/)
  assert.match(source, /body: JSON\.stringify\(\{ email, password \}\)/)
})

test('login password toggle is a non-submit accessible button using existing eye icon pattern', () => {
  assert.match(source, /import \{ Eye, EyeOff \} from 'lucide-react'/)
  assert.match(source, /className="auth-input-action"[\s\S]*type="button"/)
  assert.match(source, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/)
  assert.match(source, /aria-pressed=\{showPassword\}/)
  assert.match(source, /onClick=\{\(\) => setShowPassword\(\(visible\) => !visible\)\}/)
  assert.match(source, /showPassword \? <EyeOff size=\{18\} strokeWidth=\{1\.5\}/)
  assert.match(source, /: <Eye size=\{18\} strokeWidth=\{1\.5\}/)
})

test('login password field preserves current-password autocomplete', () => {
  assert.match(source, /id="login-password"[\s\S]*autoComplete="current-password"[\s\S]*required/)
})
