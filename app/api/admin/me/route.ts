import { NextResponse } from 'next/server'
import { adminErrorResponse } from '@/src/lib/platformAdminApi'
import { getPlatformAdminContext } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const context = await getPlatformAdminContext()
    return NextResponse.json({
      userId: context.userId,
      profile: context.profile,
      roles: context.roles,
      permissions: context.permissions,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

