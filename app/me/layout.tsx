import { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import MeCabinetShell from '@/src/components/client/MeCabinetShell'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

export default async function Layout({ children }: { children: ReactNode }) {
  const context = await getCabinetContext({ requireSession: true }).catch(() => null)
  if (!context) {
    redirect('/auth/client')
  }

  return (
    <MeCabinetShell
      profileName={context.profile.name}
      activeMode={context.activeMode}
      hasStaffPersona={context.staffMembershipsCount > 0}
    >
      {children}
    </MeCabinetShell>
  )
}
