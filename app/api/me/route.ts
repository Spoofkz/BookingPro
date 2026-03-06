import { NextResponse } from 'next/server'
import { buildCapabilitySnapshot, isDemoAuthEnabled } from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const context = await getCabinetContext()
    const capabilities = buildCapabilitySnapshot(context.memberships)

    return NextResponse.json({
      userId: context.userId,
      roles: context.roles,
      memberships: context.memberships,
      defaultClubId: context.defaultClubId,
      activeClubId: context.activeClubId,
      activeRole: context.activeRole,
      activeMode: context.activeMode,
      defaultMode: context.defaultMode,
      hasClientPersona: context.hasClientPersona,
      staffMembershipsCount: context.staffMembershipsCount,
      clubs: context.clubs,
      profile: context.profile,
      capabilities,
      demoAuthEnabled: isDemoAuthEnabled(),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
