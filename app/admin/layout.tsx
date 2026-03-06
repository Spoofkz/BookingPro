import type { ReactNode } from 'react'
import { getPlatformAdminContext } from '@/src/lib/platformAdmin'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let isAllowed = false
  try {
    await getPlatformAdminContext()
    isAllowed = true
  } catch {
    isAllowed = false
  }

  if (!isAllowed) {
    return (
      <main style={{ padding: '20px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div className="panel" style={{ padding: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Admin Access Required</h1>
          <p style={{ margin: '8px 0 0', opacity: 0.85 }}>
            This route is available only to platform admin/support/risk accounts.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{ padding: '20px', maxWidth: 1800, margin: '0 auto', width: '100%' }}>
      {children}
    </main>
  )
}
