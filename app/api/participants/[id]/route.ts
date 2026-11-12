import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { toWibString, formatGender, formatDominantHand } from '@/app/lib/export'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: queryParam } = await params
  const decodedId = decodeURIComponent(queryParam).trim()

  try {
    // ── 1. List Mode: return list of all distinct participants ───────────────
    if (decodedId === 'list') {
      const allSessions = await prisma.session.findMany({
        where: {
          OR: [
            { participantName: { not: null } },
            { participantId: { not: null } },
          ],
        },
        select: {
          id: true,
          participantName: true,
          participantId: true,
          sessionTime: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      const map = new Map<string, {
        key: string
        name: string
        id: string | null
        totalSessions: number
        completedSessions: number
        pagiCount: number
        soreCount: number
        lastActivity: string
      }>()

      for (const s of allSessions) {
        const key = (s.participantName || s.participantId || '').trim()
        if (!key) continue

        const existing = map.get(key) || {
          key,
          name: s.participantName || s.participantId || 'Tanpa Nama',
          id: s.participantId,
          totalSessions: 0,
          completedSessions: 0,
          pagiCount: 0,
          soreCount: 0,
          lastActivity: s.createdAt.toISOString(),
        }

        existing.totalSessions++
        if (s.status === 'completed') existing.completedSessions++
        if (s.sessionTime === 'PAGI') existing.pagiCount++
        if (s.sessionTime === 'SORE') existing.soreCount++

        map.set(key, existing)
      }

      return NextResponse.json(Array.from(map.values()))
    }

    // ── 2. Detail Mode: aggregate 24 gestures (12 Pagi & 12 Sore) ────────────
    const activeConfig = await prisma.sessionConfig.findFirst({
      where: { isActive: true },
    })
    const minRestHours = activeConfig?.minRestIntervalHours ?? 4.0
    const morningCutoff = activeConfig?.morningCutoffHour ?? 12

    const allGestures = await prisma.gesture.findMany({
      orderBy: { orderIndex: 'asc' },
    })

    let sessions = await prisma.session.findMany({
      where: {
        OR: [
          { participantName: { equals: decodedId, mode: 'insensitive' } },
          { participantId: { equals: decodedId, mode: 'insensitive' } },
        ],
      },
      include: {
        gesture: true,
        config: true,
        _count: {
          select: { emgRecords: true, events: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Fallback: If no exact match, try partial match (e.g. "ridha" or "fathan")
    if (sessions.length === 0) {
      const candidate = await prisma.session.findFirst({
        where: {
          OR: [
            { participantName: { contains: decodedId, mode: 'insensitive' } },
            { participantId: { contains: decodedId, mode: 'insensitive' } },
          ],
        },
        select: { participantName: true, participantId: true },
        orderBy: { createdAt: 'desc' },
      })

      if (candidate) {
        sessions = await prisma.session.findMany({
          where: {
            OR: [
              ...(candidate.participantName ? [{ participantName: candidate.participantName }] : []),
              ...(candidate.participantId ? [{ participantId: candidate.participantId }] : []),
            ],
          },
          include: {
            gesture: true,
            config: true,
            _count: {
              select: { emgRecords: true, events: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      }
    }

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: `Partisipan "${decodedId}" belum memiliki data sesi.` },
        { status: 404 }
      )
    }

    const primarySession = sessions[0]
    const participantInfo = {
      name: primarySession.participantName || primarySession.participantId || decodedId,
      id: primarySession.participantId || null,
      age: primarySession.age,
      gender: formatGender(primarySession.gender),
      dominantHand: formatDominantHand(primarySession.dominantHand),
      condition: primarySession.condition,
    }

    const pagiSessions = sessions.filter((s) => s.sessionTime === 'PAGI')
    const soreSessions = sessions.filter((s) => s.sessionTime === 'SORE')

    // Helper to map 12 gestures to their corresponding sessions
    function mapGestures(timeSlotSessions: typeof sessions, timeSlot: 'PAGI' | 'SORE') {
      return allGestures.map((g) => {
        const matches = timeSlotSessions.filter((s) => s.gestureId === g.id)
        const session = matches.find((s) => s.status === 'completed') || matches[0] || null

        return {
          gestureId: g.id,
          orderIndex: g.orderIndex,
          gestureName: g.name,
          gestureLabel: g.label,
          timeSlot,
          hasSession: session !== null,
          sessionId: session?.id || null,
          status: session?.status || 'not_created',
          emgCount: session?._count.emgRecords || 0,
          eventCount: session?._count.events || 0,
          createdAt: session?.createdAt ? session.createdAt.toISOString() : null,
          createdAtWib: session?.createdAt ? toWibString(session.createdAt) : null,
          completedAt: session?.completedAt ? session.completedAt.toISOString() : null,
          completedAtWib: session?.completedAt ? toWibString(session.completedAt) : null,
        }
      })
    }

    const pagiGestures = mapGestures(pagiSessions, 'PAGI')
    const soreGestures = mapGestures(soreSessions, 'SORE')

    const pagiCompleted = pagiGestures.filter((g) => g.status === 'completed').length
    const soreCompleted = soreGestures.filter((g) => g.status === 'completed').length
    const totalCompleted = pagiCompleted + soreCompleted
    const totalGestures = allGestures.length * 2 // 24 gestures
    const totalProgressPct = Math.round((totalCompleted / totalGestures) * 100)

    // ── 3. Calculate Inter-Session Rest Interval ──────────────────────────────
    const completedPagiSessions = pagiSessions.filter((s) => s.status === 'completed')
    let lastPagiCompletedTime: Date | null = null

    if (completedPagiSessions.length > 0) {
      // Find latest completedAt or createdAt
      const times = completedPagiSessions
        .map((s) => (s.completedAt || s.createdAt).getTime())
        .sort((a, b) => b - a)
      lastPagiCompletedTime = new Date(times[0])
    }

    // Earliest sore session if already taken
    let firstSoreStartTime: Date | null = null
    if (soreSessions.length > 0) {
      const times = soreSessions
        .map((s) => (s.startedAt || s.createdAt).getTime())
        .sort((a, b) => a - b)
      firstSoreStartTime = new Date(times[0])
    }

    let restIntervalHours: number | null = null
    let isRestMet = true
    let remainingMinutes = 0

    if (lastPagiCompletedTime) {
      const compareTime = firstSoreStartTime ? firstSoreStartTime.getTime() : Date.now()
      const diffMs = compareTime - lastPagiCompletedTime.getTime()
      restIntervalHours = Math.max(0, Math.round((diffMs / (1000 * 3600)) * 10) / 10)
      isRestMet = restIntervalHours >= minRestHours
      remainingMinutes = isRestMet
        ? 0
        : Math.max(0, Math.round((minRestHours * 60) - (diffMs / (1000 * 60))))
    }

    return NextResponse.json({
      participant: participantInfo,
      config: {
        minRestIntervalHours: minRestHours,
        morningCutoffHour: morningCutoff,
      },
      restInterval: {
        hasMorningSession: lastPagiCompletedTime !== null,
        lastPagiCompletedAt: lastPagiCompletedTime?.toISOString() || null,
        lastPagiCompletedAtWib: lastPagiCompletedTime ? toWibString(lastPagiCompletedTime) : null,
        firstSoreStartedAt: firstSoreStartTime?.toISOString() || null,
        firstSoreStartedAtWib: firstSoreStartTime ? toWibString(firstSoreStartTime) : null,
        restIntervalHours,
        isMet: isRestMet,
        remainingMinutes,
      },
      summary: {
        targetTotal: totalGestures,
        totalCompleted,
        totalProgressPct,
        pagiTarget: allGestures.length,
        pagiCompleted,
        soreTarget: allGestures.length,
        soreCompleted,
      },
      pagiGestures,
      soreGestures,
    })
  } catch (error) {
    console.error('Participant aggregation error:', error)
    return NextResponse.json(
      {
        error: 'Gagal mengambil data rekap partisipan',
        details: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
      },
      { status: 500 }
    )
  }
}
