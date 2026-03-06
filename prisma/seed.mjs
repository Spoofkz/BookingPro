import 'dotenv/config'
import crypto from 'crypto'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import {
  BookingStatus,
  ChannelType,
  CustomerType,
  PaymentStatus,
  PlatformAdminRole,
  PlatformAdminStatus,
  PricingPackagePricingType,
  PricingRuleType,
  PricingScopeType,
  PricingVersionStatus,
  PrismaClient,
  PromotionType,
  Role,
} from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const adapter = new PrismaBetterSqlite3({ url: databaseUrl })
const prisma = new PrismaClient({ adapter })

const PASSWORD_SCRYPT_LENGTH = 64
const PASSWORD_SCRYPT_N = 16384
const PASSWORD_SCRYPT_R = 8
const PASSWORD_SCRYPT_P = 1

function hashSeedPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto
    .scryptSync(password, salt, PASSWORD_SCRYPT_LENGTH, {
      N: PASSWORD_SCRYPT_N,
      r: PASSWORD_SCRYPT_R,
      p: PASSWORD_SCRYPT_P,
    })
    .toString('hex')
  return `s2$${salt}$${digest}`
}

const clubs = [
  {
    name: 'Craft Arena',
    slug: 'craft-arena',
    address: 'Almaty, Main Street 10',
    status: 'PUBLISHED',
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    description: 'Flagship gaming club with mixed segments and event sessions.',
    contactsJson: JSON.stringify({
      phone: '+77017000001',
      whatsapp: '+77017000001',
      email: 'arena@craft.example',
    }),
    businessHoursText: 'Mon-Sun 10:00-02:00',
    holdTtlMinutes: 15,
    cancellationPolicyJson: JSON.stringify({
      policy: 'flexible',
      freeCancelMinutesBeforeStart: 120,
    }),
    checkInPolicyJson: JSON.stringify({
      gracePeriodMinutes: 15,
      requireHostConfirmation: true,
    }),
    reschedulePolicyJson: JSON.stringify({
      rescheduleEnabled: true,
      rescheduleCutoffMinutesBeforeStart: 60,
      maxReschedulesPerBooking: 2,
      allowRescheduleAfterStart: false,
      rescheduleHoldTtlMinutes: 10,
      priceDeltaHandling: {
        client: 'NON_NEGATIVE_ONLY',
      },
    }),
    schedulePublishedAt: new Date('2026-01-01T00:00:00.000Z'),
    slotsGeneratedUntil: new Date('2026-12-31T23:59:59.000Z'),
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    name: 'Craft Downtown',
    slug: 'craft-downtown',
    address: 'Astana, Republic Ave 25',
    status: 'PUBLISHED',
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    description: 'Downtown branch focused on after-work and weekend sessions.',
    contactsJson: JSON.stringify({
      phone: '+77017000002',
      whatsapp: '+77017000002',
      email: 'downtown@craft.example',
    }),
    businessHoursText: 'Mon-Sun 11:00-01:00',
    holdTtlMinutes: 15,
    cancellationPolicyJson: JSON.stringify({
      policy: 'flexible',
      freeCancelMinutesBeforeStart: 120,
    }),
    checkInPolicyJson: JSON.stringify({
      gracePeriodMinutes: 15,
      requireHostConfirmation: true,
    }),
    reschedulePolicyJson: JSON.stringify({
      rescheduleEnabled: true,
      rescheduleCutoffMinutesBeforeStart: 60,
      maxReschedulesPerBooking: 2,
      allowRescheduleAfterStart: false,
      rescheduleHoldTtlMinutes: 10,
      priceDeltaHandling: {
        client: 'NON_NEGATIVE_ONLY',
      },
    }),
    schedulePublishedAt: new Date('2026-01-01T00:00:00.000Z'),
    slotsGeneratedUntil: new Date('2026-12-31T23:59:59.000Z'),
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
]

const users = [
  {
    name: 'Client Demo',
    login: 'client_demo',
    phone: '+77010000001',
    email: 'client@example.com',
    password: '12345678',
  },
  {
    name: 'Host Admin',
    login: 'host_admin',
    phone: '+77010000002',
    email: 'host@example.com',
    password: '12345678',
  },
  {
    name: 'Club Owner',
    login: 'club_owner',
    phone: '+77010000003',
    email: 'tech@example.com',
    password: '12345678',
  },
  {
    name: 'System Owner',
    login: 'system_owner',
    phone: '+77010000004',
    email: 'azamat@example.com',
    password: '12345678',
  },
]

const rooms = [
  {
    name: 'Ocean Studio',
    slug: 'ocean-studio',
    capacity: 2,
    pricePerNightCents: 11500,
  },
  {
    name: 'Garden Suite',
    slug: 'garden-suite',
    capacity: 4,
    pricePerNightCents: 18900,
  },
  {
    name: 'Penthouse Loft',
    slug: 'penthouse-loft',
    capacity: 6,
    pricePerNightCents: 29900,
  },
]

async function main() {
  const legacySlugMapping = [
    { to: 'craft-arena', fallbackSuffix: '-arena' },
    { to: 'craft-downtown', fallbackSuffix: '-downtown' },
  ]

  for (const mapping of legacySlugMapping) {
    const targetClub = await prisma.club.findUnique({
      where: { slug: mapping.to },
      select: { id: true },
    })
    if (targetClub) continue

    const legacyClub = await prisma.club.findFirst({
      where: {
        slug: { endsWith: mapping.fallbackSuffix },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
    if (!legacyClub) continue

    await prisma.club.update({
      where: { id: legacyClub.id },
      data: { slug: mapping.to },
    })
  }

  const clubBySlug = {}
  for (const club of clubs) {
    const dbClub = await prisma.club.upsert({
      where: { slug: club.slug },
      update: club,
      create: club,
    })
    clubBySlug[club.slug] = dbClub
  }

  const userByEmail = {}
  for (const user of users) {
    const passwordHash = hashSeedPassword(user.password)
    const dbUser = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        login: user.login,
        phone: user.phone,
        email: user.email,
        passwordHash,
      },
      create: {
        name: user.name,
        login: user.login,
        phone: user.phone,
        email: user.email,
        passwordHash,
      },
    })
    userByEmail[user.email] = dbUser
  }

  const platformRoles = [
    {
      userEmail: 'azamat@example.com',
      role: PlatformAdminRole.PLATFORM_ADMIN,
      notes: 'Seeded system owner platform admin',
    },
  ]

  for (const item of platformRoles) {
    const user = userByEmail[item.userEmail]
    if (!user) continue
    await prisma.platformAdminUser.upsert({
      where: {
        userId_role: {
          userId: user.id,
          role: item.role,
        },
      },
      update: {
        status: PlatformAdminStatus.ACTIVE,
        notes: item.notes,
      },
      create: {
        userId: user.id,
        role: item.role,
        status: PlatformAdminStatus.ACTIVE,
        notes: item.notes,
      },
    })
  }

  const arenaClub = clubBySlug['craft-arena']
  const downtownClub = clubBySlug['craft-downtown']

  const memberships = [
    { clubId: arenaClub.id, userId: userByEmail['client@example.com'].id, role: Role.CLIENT },
    { clubId: arenaClub.id, userId: userByEmail['host@example.com'].id, role: Role.HOST_ADMIN },
    { clubId: arenaClub.id, userId: userByEmail['tech@example.com'].id, role: Role.TECH_ADMIN },
    { clubId: arenaClub.id, userId: userByEmail['azamat@example.com'].id, role: Role.TECH_ADMIN },
    { clubId: downtownClub.id, userId: userByEmail['azamat@example.com'].id, role: Role.TECH_ADMIN },
  ]

  for (const membership of memberships) {
    await prisma.clubMembership.upsert({
      where: {
        clubId_userId_role: {
          clubId: membership.clubId,
          userId: membership.userId,
          role: membership.role,
        },
      },
      update: membership,
      create: membership,
    })
  }

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { slug: room.slug },
      update: {
        ...room,
        clubId: arenaClub.id,
      },
      create: {
        ...room,
        clubId: arenaClub.id,
      },
    })
  }

  const segmentDefs = [
    { key: 'STANDARD', name: 'Standard', color: '#14b8a6' },
    { key: 'VIP', name: 'VIP', color: '#f59e0b' },
    { key: 'BOOTCAMP', name: 'Bootcamp', color: '#ef4444' },
  ]

  const segmentByKey = {}
  for (const segmentDef of segmentDefs) {
    const segment = await prisma.segment.upsert({
      where: {
        clubId_name: {
          clubId: arenaClub.id,
          name: segmentDef.name,
        },
      },
      update: {
        description: `${segmentDef.name} segment`,
        color: segmentDef.color,
        isActive: true,
      },
      create: {
        clubId: arenaClub.id,
        name: segmentDef.name,
        description: `${segmentDef.name} segment`,
        color: segmentDef.color,
        isActive: true,
      },
    })
    segmentByKey[segmentDef.key] = segment
  }

  const roomBySlug = {}
  const allArenaRooms = await prisma.room.findMany({
    where: { clubId: arenaClub.id },
    orderBy: { id: 'asc' },
  })

  for (const room of allArenaRooms) {
    roomBySlug[room.slug] = room
  }

  const roomSegmentAssignments = [
    { slug: 'ocean-studio', segmentKey: 'STANDARD' },
    { slug: 'garden-suite', segmentKey: 'VIP' },
    { slug: 'penthouse-loft', segmentKey: 'BOOTCAMP' },
  ]

  for (const assignment of roomSegmentAssignments) {
    if (!roomBySlug[assignment.slug]) continue
    await prisma.room.update({
      where: { id: roomBySlug[assignment.slug].id },
      data: { segmentId: segmentByKey[assignment.segmentKey].id },
    })
  }

  const packages = [
    {
      key: 'PKG_2H_STANDARD',
      name: '2 Hours Standard',
      durationMinutes: 120,
      pricingType: PricingPackagePricingType.FIXED_PRICE,
      fixedPriceCents: 2500,
      segmentKeys: ['STANDARD'],
      roomSlugs: [],
      visibleToClients: true,
      visibleToHosts: true,
      applyTimeModifiers: false,
    },
    {
      key: 'PKG_5H_ALL',
      name: '5 Hours Saver',
      durationMinutes: 300,
      pricingType: PricingPackagePricingType.DISCOUNTED_HOURLY,
      discountPercent: 15,
      segmentKeys: [],
      roomSlugs: [],
      visibleToClients: true,
      visibleToHosts: true,
      applyTimeModifiers: true,
    },
    {
      key: 'PKG_BOOTCAMP_3H',
      name: 'Bootcamp Session 3h',
      durationMinutes: 180,
      pricingType: PricingPackagePricingType.RATE_PER_HOUR,
      ratePerHourCents: 1800,
      segmentKeys: ['BOOTCAMP'],
      roomSlugs: ['penthouse-loft'],
      visibleToClients: true,
      visibleToHosts: true,
      applyTimeModifiers: false,
    },
  ]

  const packageByKey = {}
  for (const packageDef of packages) {
    const pricingPackage = await prisma.pricingPackage.upsert({
      where: {
        id: `${arenaClub.id}_${packageDef.key}`.toLowerCase(),
      },
      update: {
        name: packageDef.name,
        durationMinutes: packageDef.durationMinutes,
        pricingType: packageDef.pricingType,
        fixedPriceCents: packageDef.fixedPriceCents ?? null,
        discountPercent: packageDef.discountPercent ?? null,
        ratePerHourCents: packageDef.ratePerHourCents ?? null,
        visibleToClients: packageDef.visibleToClients,
        visibleToHosts: packageDef.visibleToHosts,
        applyTimeModifiers: packageDef.applyTimeModifiers,
        isActive: true,
      },
      create: {
        id: `${arenaClub.id}_${packageDef.key}`.toLowerCase(),
        clubId: arenaClub.id,
        name: packageDef.name,
        durationMinutes: packageDef.durationMinutes,
        pricingType: packageDef.pricingType,
        fixedPriceCents: packageDef.fixedPriceCents ?? null,
        discountPercent: packageDef.discountPercent ?? null,
        ratePerHourCents: packageDef.ratePerHourCents ?? null,
        visibleToClients: packageDef.visibleToClients,
        visibleToHosts: packageDef.visibleToHosts,
        applyTimeModifiers: packageDef.applyTimeModifiers,
        isActive: true,
      },
    })

    await prisma.packageSegment.deleteMany({
      where: { packageId: pricingPackage.id },
    })
    await prisma.packageRoom.deleteMany({
      where: { packageId: pricingPackage.id },
    })

    if (packageDef.segmentKeys.length > 0) {
      await prisma.packageSegment.createMany({
        data: packageDef.segmentKeys.map((segmentKey) => ({
          packageId: pricingPackage.id,
          segmentId: segmentByKey[segmentKey].id,
        })),
      })
    }

    if (packageDef.roomSlugs.length > 0) {
      await prisma.packageRoom.createMany({
        data: packageDef.roomSlugs
          .map((roomSlug) => roomBySlug[roomSlug])
          .filter(Boolean)
          .map((room) => ({
            packageId: pricingPackage.id,
            roomId: room.id,
          })),
      })
    }

    packageByKey[packageDef.key] = pricingPackage
  }

  const maxVersion = await prisma.pricingVersion.findFirst({
    where: { clubId: arenaClub.id },
    orderBy: { versionNumber: 'desc' },
  })

  const publishedVersion = await prisma.pricingVersion.upsert({
    where: {
      id: `${arenaClub.id}_pricing_v1`.toLowerCase(),
    },
    update: {
      versionNumber: maxVersion?.versionNumber ?? 1,
      status: PricingVersionStatus.PUBLISHED,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedByUserId: userByEmail['tech@example.com'].id,
    },
    create: {
      id: `${arenaClub.id}_pricing_v1`.toLowerCase(),
      clubId: arenaClub.id,
      versionNumber: maxVersion?.versionNumber ?? 1,
      status: PricingVersionStatus.PUBLISHED,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedByUserId: userByEmail['tech@example.com'].id,
    },
  })

  await prisma.pricingRule.deleteMany({
    where: { pricingVersionId: publishedVersion.id },
  })

  const rules = [
    {
      ruleType: PricingRuleType.BASE_RATE,
      priority: 10,
      scopeType: PricingScopeType.SEGMENT,
      scopeId: segmentByKey.STANDARD.id,
      setRatePerHourCents: 1400,
      label: 'Standard base',
    },
    {
      ruleType: PricingRuleType.BASE_RATE,
      priority: 10,
      scopeType: PricingScopeType.SEGMENT,
      scopeId: segmentByKey.VIP.id,
      setRatePerHourCents: 2200,
      label: 'VIP base',
    },
    {
      ruleType: PricingRuleType.BASE_RATE,
      priority: 10,
      scopeType: PricingScopeType.SEGMENT,
      scopeId: segmentByKey.BOOTCAMP.id,
      setRatePerHourCents: 2000,
      label: 'Bootcamp base',
    },
    {
      ruleType: PricingRuleType.TIME_MODIFIER,
      priority: 20,
      scopeType: PricingScopeType.SEGMENT,
      scopeId: segmentByKey.STANDARD.id,
      dayOfWeekCsv: '0,6',
      addPercent: 10,
      label: 'Weekend +10%',
    },
    {
      ruleType: PricingRuleType.TIME_MODIFIER,
      priority: 30,
      scopeType: PricingScopeType.SEGMENT,
      scopeId: segmentByKey.STANDARD.id,
      timeWindowStartMinute: 1080,
      timeWindowEndMinute: 1380,
      addPercent: 20,
      label: 'Peak +20%',
    },
    {
      ruleType: PricingRuleType.OVERRIDE,
      priority: 40,
      scopeType: PricingScopeType.ROOM,
      scopeId: String(roomBySlug['garden-suite']?.id ?? 0),
      setRatePerHourCents: 2600,
      label: 'Garden Suite override',
    },
  ]

  for (const rule of rules) {
    if (!rule.scopeId || rule.scopeId === '0') continue
    await prisma.pricingRule.create({
      data: {
        pricingVersionId: publishedVersion.id,
        ruleType: rule.ruleType,
        priority: rule.priority,
        scopeType: rule.scopeType,
        scopeId: rule.scopeId,
        dayOfWeekCsv: rule.dayOfWeekCsv ?? null,
        timeWindowStartMinute: rule.timeWindowStartMinute ?? null,
        timeWindowEndMinute: rule.timeWindowEndMinute ?? null,
        channel: rule.channel ?? null,
        customerType: rule.customerType ?? null,
        setRatePerHourCents: rule.setRatePerHourCents ?? null,
        addPercent: rule.addPercent ?? null,
        addFixedAmountCents: rule.addFixedAmountCents ?? null,
        addFixedMode: rule.addFixedMode ?? null,
        exclusive: false,
        label: rule.label,
      },
    })
  }

  await prisma.promotion.upsert({
    where: {
      clubId_code: {
        clubId: arenaClub.id,
        code: 'HAPPY500',
      },
    },
    update: {
      type: PromotionType.PROMO_CODE_FIXED,
      activeFrom: new Date('2026-01-01T00:00:00.000Z'),
      activeTo: new Date('2028-01-01T00:00:00.000Z'),
      fixedOffCents: 500,
      percentOff: null,
      minTotalCents: 1500,
      isActive: true,
    },
    create: {
      clubId: arenaClub.id,
      code: 'HAPPY500',
      type: PromotionType.PROMO_CODE_FIXED,
      activeFrom: new Date('2026-01-01T00:00:00.000Z'),
      activeTo: new Date('2028-01-01T00:00:00.000Z'),
      fixedOffCents: 500,
      minTotalCents: 1500,
      isActive: true,
    },
  })

  const seededRoom = await prisma.room.findUnique({
    where: { slug: 'ocean-studio' },
  })

  if (seededRoom) {
    const booking = await prisma.booking.upsert({
      where: { id: 10001 },
      update: {
        clubId: arenaClub.id,
        roomId: seededRoom.id,
        clientUserId: userByEmail['client@example.com'].id,
        guestName: 'Client Demo',
        guestEmail: 'client@example.com',
        checkIn: new Date('2026-02-20T10:00:00.000Z'),
        checkOut: new Date('2026-02-20T12:00:00.000Z'),
        guests: 1,
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        packageId: packageByKey.PKG_2H_STANDARD?.id || null,
        pricingVersionId: publishedVersion.id,
        channel: ChannelType.ONLINE,
        customerType: CustomerType.GUEST,
        priceTotalCents: 2500,
        priceCurrency: 'KZT',
        priceSnapshotJson: JSON.stringify([
          { type: 'BASE_RATE', label: 'Standard base', amount: 2800 },
          { type: 'PACKAGE', label: '2 Hours Standard fixed price', amount: -300 },
        ]),
        packageSnapshotJson: JSON.stringify({
          id: packageByKey.PKG_2H_STANDARD?.id || null,
          name: '2 Hours Standard',
          durationMinutes: 120,
          pricingType: 'FIXED_PRICE',
        }),
      },
      create: {
        id: 10001,
        clubId: arenaClub.id,
        roomId: seededRoom.id,
        clientUserId: userByEmail['client@example.com'].id,
        guestName: 'Client Demo',
        guestEmail: 'client@example.com',
        checkIn: new Date('2026-02-20T10:00:00.000Z'),
        checkOut: new Date('2026-02-20T12:00:00.000Z'),
        guests: 1,
        notes: 'Seed booking for cabinet demo',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        packageId: packageByKey.PKG_2H_STANDARD?.id || null,
        pricingVersionId: publishedVersion.id,
        channel: ChannelType.ONLINE,
        customerType: CustomerType.GUEST,
        priceTotalCents: 2500,
        priceCurrency: 'KZT',
        priceSnapshotJson: JSON.stringify([
          { type: 'BASE_RATE', label: 'Standard base', amount: 2800 },
          { type: 'PACKAGE', label: '2 Hours Standard fixed price', amount: -300 },
        ]),
        packageSnapshotJson: JSON.stringify({
          id: packageByKey.PKG_2H_STANDARD?.id || null,
          name: '2 Hours Standard',
          durationMinutes: 120,
          pricingType: 'FIXED_PRICE',
        }),
      },
    })

    await prisma.payment.upsert({
      where: { id: 20001 },
      update: {
        clubId: arenaClub.id,
        bookingId: booking.id,
        amountCents: 11500,
        method: 'ONLINE_CARD',
        providerRef: 'seed-payment-20001',
        status: PaymentStatus.PAID,
      },
      create: {
        id: 20001,
        clubId: arenaClub.id,
        bookingId: booking.id,
        amountCents: 11500,
        method: 'ONLINE_CARD',
        providerRef: 'seed-payment-20001',
        status: PaymentStatus.PAID,
      },
    })
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
