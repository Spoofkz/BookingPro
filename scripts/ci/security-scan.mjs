#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const findings = []

const SECRET_PATTERNS = [
  { name: 'AWS secret key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Generic private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Bearer token literal', regex: /Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*/g },
]

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'out'])
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.sql', '.env', '.txt',
])

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(abs)
      continue
    }
    const ext = path.extname(entry.name)
    if (!TEXT_EXTS.has(ext) && !entry.name.startsWith('.env')) continue
    const rel = path.relative(root, abs)
    const content = fs.readFileSync(abs, 'utf8')
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        findings.push(`[secret] ${pattern.name}: ${rel}`)
      }
      pattern.regex.lastIndex = 0
    }
  }
}

function scanAdminRbac() {
  const adminDir = path.join(root, 'app', 'api', 'admin')
  if (!fs.existsSync(adminDir)) return
  const routeFiles = []
  ;(function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(abs)
      else if (entry.isFile() && entry.name === 'route.ts') routeFiles.push(abs)
    }
  })(adminDir)

  for (const file of routeFiles) {
    const rel = path.relative(root, file)
    const content = fs.readFileSync(file, 'utf8')
    const hasGate =
      content.includes('requirePlatformPermission(') ||
      content.includes('requirePlatformPermission (') ||
      content.includes('requirePlatformRole(') ||
      content.includes('getPlatformAdminContext(')
    if (!hasGate) {
      findings.push(`[rbac] Missing platform permission gate in ${rel}`)
    }
  }
}

function scanDangerousPatterns() {
  const appDir = path.join(root, 'app')
  if (!fs.existsSync(appDir)) return
  const patterns = [
    { label: 'eval usage', regex: /\beval\s*\(/ },
    { label: 'Function constructor', regex: /\bnew Function\s*\(/ },
  ]
  ;(function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(abs)
      else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const rel = path.relative(root, abs)
        const content = fs.readFileSync(abs, 'utf8')
        for (const pattern of patterns) {
          if (pattern.regex.test(content)) findings.push(`[sast] ${pattern.label}: ${rel}`)
        }
      }
    }
  })(appDir)
}

walk(root)
scanAdminRbac()
scanDangerousPatterns()

if (findings.length > 0) {
  console.error('Security scan findings:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('Security scan passed (secret scan + RBAC gate scan + basic SAST patterns).')
