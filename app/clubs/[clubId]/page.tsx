import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { parseSeatMapJson } from '@/src/lib/seatMapSchema'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ clubId: string }>
}

function parseContacts(input: string | null) {
  if (!input) return {}
  try {
    const value = JSON.parse(input) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseStringArrayJson(input: string | null) {
  if (!input) return []
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

export default async function ClubPage({ params }: PageProps) {
  const { clubId } = await params
  const now = new Date()
  const weekAhead = addDays(now, 7)

  const club = await prisma.club.findFirst({
    where: {
      status: CLUB_STATUSES.PUBLISHED,
      OR: [{ id: clubId }, { slug: clubId }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      city: true,
      area: true,
      address: true,
      description: true,
      contactsJson: true,
      businessHoursText: true,
      timezone: true,
      currency: true,
      logoUrl: true,
      galleryJson: true,
      amenitiesJson: true,
      geoLat: true,
      geoLng: true,
      startingFromAmount: true,
      startingFromSegment: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
    },
  })

  if (!club) {
    notFound()
  }

  const [latestMap, openNowSlot, nextSlot, schedulePreviewSlots, feature, packages] = await Promise.all([
    prisma.seatMapVersion.findFirst({
      where: { clubId: club.id },
      orderBy: { versionNumber: 'desc' },
      select: {
        versionNumber: true,
        seatCount: true,
        publishedJson: true,
        publishedAt: true,
      },
    }),
    prisma.slot.findFirst({
      where: {
        clubId: club.id,
        status: 'PUBLISHED',
        startAtUtc: { lte: now },
        endAtUtc: { gt: now },
      },
      select: { id: true },
    }),
    prisma.slot.findFirst({
      where: {
        clubId: club.id,
        status: 'PUBLISHED',
        startAtUtc: { gte: now },
      },
      orderBy: { startAtUtc: 'asc' },
      select: {
        id: true,
        startAtUtc: true,
        endAtUtc: true,
        localDate: true,
      },
    }),
    prisma.slot.findMany({
      where: {
        clubId: club.id,
        status: 'PUBLISHED',
        startAtUtc: { gte: now, lt: weekAhead },
      },
      orderBy: { startAtUtc: 'asc' },
      select: {
        id: true,
        localDate: true,
        startAtUtc: true,
        endAtUtc: true,
      },
      take: 200,
    }),
    prisma.clubFeatured.findFirst({
      where: {
        clubId: club.id,
        isActive: true,
        featuredStartAt: { lte: now },
        featuredEndAt: { gt: now },
      },
      orderBy: [{ featuredRank: 'asc' }, { createdAt: 'desc' }],
      select: {
        featuredRank: true,
        badgeText: true,
      },
    }),
    prisma.pricingPackage.findMany({
      where: {
        clubId: club.id,
        isActive: true,
        visibleToClients: true,
      },
      orderBy: [{ durationMinutes: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        pricingType: true,
      },
      take: 8,
    }),
  ])

  const mapDoc = latestMap ? parseSeatMapJson(latestMap.publishedJson) : null
  const floors = mapDoc?.floors ?? []
  const contacts = parseContacts(club.contactsJson)
  const phone = typeof contacts.phone === 'string' ? contacts.phone : null
  const whatsapp = typeof contacts.whatsapp === 'string' ? contacts.whatsapp : null
  const email = typeof contacts.email === 'string' ? contacts.email : null
  const gallery = parseStringArrayJson(club.galleryJson)
  const amenities = parseStringArrayJson(club.amenitiesJson)

  const scheduleByDate = new Map<
    string,
    {
      localDate: string
      slotCount: number
      firstStartAt: Date
      lastEndAt: Date
    }
  >()
  for (const slot of schedulePreviewSlots) {
    const existing = scheduleByDate.get(slot.localDate)
    if (!existing) {
      scheduleByDate.set(slot.localDate, {
        localDate: slot.localDate,
        slotCount: 1,
        firstStartAt: slot.startAtUtc,
        lastEndAt: slot.endAtUtc,
      })
      continue
    }
    existing.slotCount += 1
    if (slot.startAtUtc < existing.firstStartAt) existing.firstStartAt = slot.startAtUtc
    if (slot.endAtUtc > existing.lastEndAt) existing.lastEndAt = slot.endAtUtc
  }
  const scheduleSummary = Array.from(scheduleByDate.values()).sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  )

  const bookingAvailable =
    Boolean(club.schedulePublishedAt) &&
    Boolean(club.slotsGeneratedUntil) &&
    Boolean(nextSlot)

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto w-full max-w-[1800px] space-y-4">
        <header className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Public Club Page</p>
              <h1 className="mt-2 text-3xl font-semibold">{club.name}</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">{club.description || 'No description yet.'}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {club.city || 'City n/a'} · {club.area || 'Area n/a'} · {club.currency} · {club.timezone}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">{club.address || 'Address not specified.'}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {openNowSlot ? 'Open now' : 'Closed now'}
                {nextSlot ? ` · Next slot ${new Date(nextSlot.startAtUtc).toLocaleString()}` : ''}
              </p>
              {feature ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {feature.badgeText || 'Featured'} · Rank {feature.featuredRank}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Link
                href={`/bookings?clubId=${club.id}`}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-white/10"
              >
                Book now
              </Link>
              <Link
                href="/clubs"
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-center text-sm hover:bg-white/10"
              >
                Back to listing
              </Link>
            </div>
          </div>
        </header>

        {!bookingAvailable ? (
          <article className="panel-strong p-4 text-sm text-amber-700 dark:text-amber-300">
            Booking is not available yet for this club. Please check later or contact the club directly.
          </article>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Pricing Preview</h2>
            {club.startingFromAmount == null ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No pricing hint published.</p>
            ) : (
              <p className="mt-2 text-sm">
                From <span className="font-semibold">{club.startingFromAmount} {club.currency}</span>
                {club.startingFromSegment ? ` · ${club.startingFromSegment}` : ''}
              </p>
            )}
          </article>

          <article className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Amenities</h2>
            {amenities.length < 1 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No amenities configured.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1">
                {amenities.map((amenity) => (
                  <span key={amenity} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                    {amenity}
                  </span>
                ))}
              </div>
            )}
          </article>

          <article className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Contact</h2>
            <p className="mt-2 text-sm">Phone: {phone || '-'}</p>
            <p className="text-sm">WhatsApp: {whatsapp || '-'}</p>
            <p className="text-sm">Email: {email || '-'}</p>
          </article>
        </section>

        <section className="panel-strong p-4">
          <h2 className="text-lg font-semibold">Schedule Preview (7 days)</h2>
          {scheduleSummary.length < 1 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">No published slots in the next 7 days.</p>
          ) : (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {scheduleSummary.map((item) => (
                <article key={item.localDate} className="panel rounded-lg p-2 text-sm">
                  <p className="font-medium">{item.localDate}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {item.slotCount} slots · {new Date(item.firstStartAt).toLocaleTimeString()} -{' '}
                    {new Date(item.lastEndAt).toLocaleTimeString()}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Packages</h2>
            {packages.length < 1 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No package highlights yet.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {packages.map((pkg) => (
                  <p key={pkg.id} className="text-sm">
                    {pkg.name} · {pkg.durationMinutes}m · {pkg.pricingType}
                  </p>
                ))}
              </div>
            )}
          </article>

          <article className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Map Summary</h2>
            {!latestMap ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No published map yet.</p>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <p>
                  Version {latestMap.versionNumber} · Seats {latestMap.seatCount}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Published {new Date(latestMap.publishedAt).toLocaleString()}
                </p>
                {floors.map((floor) => (
                  <article key={floor.floorId} className="panel rounded-lg p-2">
                    <p className="font-medium">{floor.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      Rooms: {floor.rooms.length} · Seats:{' '}
                      {floor.elements.filter((element) => element.type === 'seat').length}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        {gallery.length > 0 || club.logoUrl ? (
          <section className="panel-strong p-4">
            <h2 className="text-lg font-semibold">Photos</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {[club.logoUrl, ...gallery].filter(Boolean).slice(0, 8).map((url) => (
                <span
                  key={url}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"
                >
                  {url}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
