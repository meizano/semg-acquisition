import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { formatGender, formatDominantHand } from '@/app/lib/export'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: queryId } = await params

  try {
    // 1. Find sessions matching participantId, participantName, or direct sessionId
    let sessions = await prisma.session.findMany({
      where: {
        OR: [
          { participantId: queryId },
          { participantName: queryId },
          { id: queryId },
        ],
      },
      include: {
        gesture: true,
        config: true,
        emgRecords: {
          where: { phase: 'ACTION' },
          select: {
            sampleIndex: true,
            elapsedMs: true,
            phase: true,
            p1: true,
            p2: true,
            p3: true,
            p4: true,
            p5: true,
            p6: true,
          },
          orderBy: { sampleIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // If searched by sessionId, also include related sessions for this participant within 24h
    if (sessions.length > 0 && sessions[0].id === queryId) {
      const primary = sessions[0]
      const related = await prisma.session.findMany({
        where: {
          ...(primary.participantId
            ? { participantId: primary.participantId }
            : primary.participantName
            ? { participantName: primary.participantName }
            : { id: primary.id }),
          createdAt: {
            gte: new Date(primary.createdAt.getTime() - 24 * 60 * 60 * 1000),
            lte: new Date(primary.createdAt.getTime() + 24 * 60 * 60 * 1000),
          },
        },
        include: {
          gesture: true,
          config: true,
          emgRecords: {
            where: { phase: 'ACTION' },
            select: {
              sampleIndex: true,
              elapsedMs: true,
              phase: true,
              p1: true,
              p2: true,
              p3: true,
              p4: true,
              p5: true,
              p6: true,
            },
            orderBy: { sampleIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      sessions = related
    }

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: `Data sesi untuk partisipan / ID ${queryId} tidak ditemukan` },
        { status: 404 }
      )
    }

    // 2. Fetch all 12 gestures in strict orderIndex sequence
    const allGestures = await prisma.gesture.findMany({
      orderBy: { orderIndex: 'asc' },
    })

    const primarySession = sessions[0]
    const participantInfo = {
      participantId: primarySession.participantId,
      participantName: primarySession.participantName || '-',
      age: primarySession.age,
      gender: formatGender(primarySession.gender),
      dominantHand: formatDominantHand(primarySession.dominantHand),
      condition: primarySession.condition,
    }

    // 3. Map each gesture to its audit result
    const gestureAudits = allGestures.map((g) => {
      // Find the best session for this gesture (prefer completed, otherwise latest)
      const matching = sessions.filter((s) => s.gestureId === g.id)
      const session = matching.find((s) => s.status === 'completed') || matching[0] || null

      if (!session) {
        return {
          gestureId: g.id,
          orderIndex: g.orderIndex,
          gestureName: g.name,
          gestureLabel: g.label,
          status: 'NOT_RECORDED',
          sessionId: null,
          targetActionDurationSec: 0,
          targetSamples: 0,
          actualActionSamples: 0,
          activeSamples: 0,
          idleSamples: 0,
          completenessPct: 0,
          activeSecondsCovered: 0,
          rating: 'MISSING',
          ratingLabel: 'Belum Direkam',
          recommendation: 'Perlu Pengambilan Data',
        }
      }

      const actionDuration = session.config?.actionDuration ?? 5
      const repetitionCount = session.config?.repetitionCount ?? 10
      const targetActionDurationSec = actionDuration * repetitionCount
      const targetSamples = targetActionDurationSec * 200 // 200 Hz

      const actionRecords = session.emgRecords.filter((r) => r.phase === 'ACTION')
      const actualActionSamples = actionRecords.length

      // Active sample: at least 1 channel > 10 (above electronic baseline noise floor 1,4,9)
      const activeSamples = actionRecords.filter(
        (r) =>
          r.p1 > 10 ||
          r.p2 > 10 ||
          r.p3 > 10 ||
          r.p4 > 10 ||
          r.p5 > 10 ||
          r.p6 > 10
      ).length

      const idleSamples = actualActionSamples - activeSamples

      // Time-bin coverage per second
      const secondBins = new Map<number, number>()
      for (const r of actionRecords) {
        if (
          r.p1 > 10 ||
          r.p2 > 10 ||
          r.p3 > 10 ||
          r.p4 > 10 ||
          r.p5 > 10 ||
          r.p6 > 10
        ) {
          const sec = Math.floor(r.elapsedMs / 1000)
          secondBins.set(sec, (secondBins.get(sec) || 0) + 1)
        }
      }
      // A second is covered if it contains active samples
      const activeSecondsCovered = secondBins.size

      // Completeness percentage (capped at 100%)
      const completenessPct =
        targetSamples > 0
          ? Math.min(100, Math.round((activeSamples / targetSamples) * 1000) / 10)
          : 0

      let rating: 'EXCELLENT' | 'GOOD' | 'NEEDS_RETAKE' = 'EXCELLENT'
      let ratingLabel = 'Data Siap'
      let recommendation = 'Sinyal Optimal & Lengkap'

      if (session.status !== 'completed' || completenessPct < 75) {
        rating = 'NEEDS_RETAKE'
        ratingLabel = 'Perlu Pengambilan Ulang'
        recommendation =
          actualActionSamples === 0
            ? 'Data ACTION tidak ditemukan (sensor/bridge tidak merekam)'
            : completenessPct < 50
            ? 'Sinyal sangat lemah atau flatline pada fase ACTION'
            : 'Kelengkapan sinyal di bawah 75%'
      } else if (completenessPct < 90) {
        rating = 'GOOD'
        ratingLabel = 'Cukup Baik'
        recommendation = 'Data dapat digunakan, namun sedikit berfluktuasi'
      }

      return {
        gestureId: g.id,
        orderIndex: g.orderIndex,
        gestureName: g.name,
        gestureLabel: g.label,
        status: session.status,
        sessionId: session.id,
        targetActionDurationSec,
        targetSamples,
        actualActionSamples,
        activeSamples,
        idleSamples,
        completenessPct,
        activeSecondsCovered,
        rating,
        ratingLabel,
        recommendation,
      }
    })

    // 4. Global statistics
    const completedList = gestureAudits.filter(
      (g) => g.status === 'completed' && g.rating !== 'NEEDS_RETAKE'
    )
    const completedCount = completedList.length
    const totalGestures = allGestures.length
    const gestureProgressPct = Math.round((completedCount / totalGestures) * 100)

    const completedAudits = gestureAudits.filter((g) => g.sessionId !== null)
    const averageActionCompletenessPct =
      completedAudits.length > 0
        ? Math.round(
            (completedAudits.reduce((acc, curr) => acc + curr.completenessPct, 0) /
              completedAudits.length) *
              10
          ) / 10
        : 0

    // 5. Detect loss pattern
    const problematic = gestureAudits.filter(
      (g) => g.rating === 'NEEDS_RETAKE' || g.status === 'NOT_RECORDED'
    )

    let lossPatternType: 'DISTRIBUTED_NORMAL' | 'CONCENTRATED_LOSS' | 'INCOMPLETE_GESTURES'
    let lossPatternTitle: string
    let lossPatternDescription: string

    if (problematic.length === 0 && averageActionCompletenessPct >= 90) {
      lossPatternType = 'DISTRIBUTED_NORMAL'
      lossPatternTitle = 'Data Sinyal Sangat Baik & Data Siap'
      lossPatternDescription =
        'Seluruh 12 gesture terekam lengkap dengan rata-rata keaktifan sinyal tinggi. Fluktuasi mikro adalah jitter normal transmisi serial dan sangat layak digunakan untuk supervised learning.'
    } else if (problematic.length > 0 && problematic.length <= 3) {
      lossPatternType = 'CONCENTRATED_LOSS'
      const names = problematic.map((p) => `#${p.orderIndex} ${p.gestureName}`).join(', ')
      lossPatternTitle = `Kehilangan Data Terkonsentrasi pada ${problematic.length} Gesture`
      lossPatternDescription = `Anomali data terdeteksi khusus pada gesture: ${names}. Gesture lainnya terekam dengan baik. Sangat disarankan melakukan pengambilan ulang (retake) khusus untuk gesture yang bermasalah tersebut.`
    } else {
      lossPatternType = 'INCOMPLETE_GESTURES'
      lossPatternTitle = `${totalGestures - completedCount} Gesture Belum Lengkap`
      lossPatternDescription = `Sebagian besar gesture belum direkam atau mengalami gangguan sinyal. Harap selesaikan rangkaian sesi terlebih dahulu.`
    }

    return NextResponse.json({
      participant: participantInfo,
      summary: {
        totalGestures,
        completedCount,
        gestureProgressPct,
        averageActionCompletenessPct,
        lossPattern: {
          type: lossPatternType,
          title: lossPatternTitle,
          description: lossPatternDescription,
          problematicGestures: problematic.map((p) => ({
            orderIndex: p.orderIndex,
            gestureName: p.gestureName,
            completenessPct: p.completenessPct,
            sessionId: p.sessionId,
          })),
        },
      },
      gestures: gestureAudits,
    })
  } catch (error) {
    console.error('Audit calculation error:', error)
    return NextResponse.json(
      { error: 'Gagal melakukan audit kelengkapan data partisipan' },
      { status: 500 }
    )
  }
}
