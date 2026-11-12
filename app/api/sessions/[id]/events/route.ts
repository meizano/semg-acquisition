import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { exportToCSV, exportToJSON, toWibString } from '@/app/lib/export'
import type { ExportData } from '@/app/lib/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format')?.toLowerCase() || 'json'

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      gesture: true,
      config: true,
      events: {
        orderBy: { timestamp: 'asc' },
      },
      emgRecords: {
        orderBy: { sampleIndex: 'asc' },
      },
    },
  })

  if (!session) {
    return NextResponse.json(
      { error: `Session ${sessionId} tidak ditemukan` },
      { status: 404 }
    )
  }

  const filenameBase = `session_${sessionId.slice(-8)}_${session.gesture.name.replace(/\s+/g, '_')}`

  // ── CSV Format ─────────────────────────────────────────────────────────────
  if (format === 'csv') {
    let csvString = ''

    if (session.emgRecords.length > 0) {
      // Primary scientific 6-channel sEMG dataset CSV
      const headers = [
        'sample_index',
        'elapsed_ms',
        'phase',
        'is_transition',
        'gesture',
        'raw_ch1',
        'raw_ch2',
        'raw_ch3',
        'raw_ch4',
        'raw_ch5',
        'raw_ch6',
        'proc_ch1',
        'proc_ch2',
        'proc_ch3',
        'proc_ch4',
        'proc_ch5',
        'proc_ch6',
        'participant_name',
        'participant_id',
        'session_id',
        'waktu_sesi',
        'timestamp_wib',
        'timestamp_utc',
      ]

      const rows = session.emgRecords.map((r) => [
        r.sampleIndex,
        r.elapsedMs,
        r.phase,
        r.isTransition ? 1 : 0,
        `"${r.gesture || session.gesture.name}"`,
        r.r1,
        r.r2,
        r.r3,
        r.r4,
        r.r5,
        r.r6,
        r.p1,
        r.p2,
        r.p3,
        r.p4,
        r.p5,
        r.p6,
        `"${session.participantName || ''}"`,
        `"${session.participantId || ''}"`,
        `"${session.id}"`,
        `"${session.sessionTime || 'PAGI'}"`,
        `"${toWibString(r.createdAt)}"`,
        `"${r.createdAt.toISOString()}"`,
      ].join(','))

      csvString = [headers.join(','), ...rows].join('\n')
    } else {
      // Fallback to events log CSV if no EMG records exist
      const exportData: ExportData = {
        sessionId: session.id,
        participantId: session.participantId,
        participantName: session.participantName || '-',
        age: session.age,
        gender: session.gender,
        dominantHand: session.dominantHand,
        condition: session.condition,
        sessionTime: session.sessionTime,
        gestureName: session.gesture.name,
        gestureLabel: session.gesture.label,
        events: session.events.map((e) => ({
          eventType: e.eventType,
          repetitionNum: e.repetitionNum,
          timestamp: e.timestamp.toISOString(),
          clientTimestamp: e.clientTimestamp.toString(),
          metadata: (e.metadata as Record<string, unknown>) || null,
        })),
      }
      csvString = exportToCSV(exportData)
    }

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
      },
    })
  }

  // ── JSON Format ────────────────────────────────────────────────────────────
  const samplesByPhase = {
    PREPARATION: 0,
    ACTION: 0,
    REST: 0,
  }
  for (const r of session.emgRecords) {
    if (r.phase in samplesByPhase) {
      samplesByPhase[r.phase as keyof typeof samplesByPhase]++
    }
  }

  const jsonPayload = {
    session: {
      id: session.id,
      participantId: session.participantId,
      participantName: session.participantName || '-',
      age: session.age,
      gender: session.gender,
      dominantHand: session.dominantHand,
      condition: session.condition,
      gesture: {
        id: session.gesture.id,
        name: session.gesture.name,
        label: session.gesture.label,
        orderIndex: session.gesture.orderIndex,
      },
      config: session.config
        ? {
            name: session.config.name,
            preparationDurationSeconds: session.config.preparationDuration,
            actionDurationSeconds: session.config.actionDuration,
            restDurationSeconds: session.config.restDuration,
            repetitionCount: session.config.repetitionCount,
          }
        : null,
      status: session.status,
      sessionTime: session.sessionTime || 'PAGI',
      startedAt: session.startedAt?.toISOString() || null,
      startedAtWib: toWibString(session.startedAt) || null,
      completedAt: session.completedAt?.toISOString() || null,
      completedAtWib: toWibString(session.completedAt) || null,
      createdAt: session.createdAt.toISOString(),
      createdAtWib: toWibString(session.createdAt),
    },
    statistics: {
      totalEmgSamples: session.emgRecords.length,
      totalEvents: session.events.length,
      samplesByPhase,
    },
    channels: {
      count: 6,
      descriptions: [
        { channel: 1, pin: 'A0', rawKey: 'r1', procKey: 'p1' },
        { channel: 2, pin: 'A1', rawKey: 'r2', procKey: 'p2' },
        { channel: 3, pin: 'A2', rawKey: 'r3', procKey: 'p3' },
        { channel: 4, pin: 'A3', rawKey: 'r4', procKey: 'p4' },
        { channel: 5, pin: 'A4', rawKey: 'r5', procKey: 'p5' },
        { channel: 6, pin: 'A5', rawKey: 'r6', procKey: 'p6' },
      ],
    },
    events: session.events.map((e) => ({
      eventType: e.eventType,
      repetitionNum: e.repetitionNum,
      timestamp: e.timestamp.toISOString(),
      timestampWib: toWibString(e.timestamp),
      clientTimestamp: e.clientTimestamp.toString(),
      metadata: (e.metadata as Record<string, unknown>) || null,
    })),
    emgRecords: session.emgRecords.map((r) => ({
      sampleIndex: r.sampleIndex,
      elapsedMs: r.elapsedMs,
      phase: r.phase,
      isTransition: r.isTransition,
      gesture: r.gesture || session.gesture.name,
      raw: {
        ch1: r.r1,
        ch2: r.r2,
        ch3: r.r3,
        ch4: r.r4,
        ch5: r.r5,
        ch6: r.r6,
      },
      processed: {
        ch1: r.p1,
        ch2: r.p2,
        ch3: r.p3,
        ch4: r.p4,
        ch5: r.p5,
        ch6: r.p6,
      },
      channels: {
        r1: r.r1,
        r2: r.r2,
        r3: r.r3,
        r4: r.r4,
        r5: r.r5,
        r6: r.r6,
        p1: r.p1,
        p2: r.p2,
        p3: r.p3,
        p4: r.p4,
        p5: r.p5,
        p6: r.p6,
      },
      timestamp: r.createdAt.toISOString(),
      timestampWib: toWibString(r.createdAt),
    })),
  }

  return new NextResponse(JSON.stringify(jsonPayload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const events = await request.json()

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 })
    }

    // Verify session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    })

    if (!session) {
      return NextResponse.json(
        { error: `Session ${sessionId} tidak ditemukan` },
        { status: 404 }
      )
    }

    const result = await prisma.eventLog.createMany({
      data: events.map((e: any) => ({
        sessionId,
        eventType: e.eventType,
        repetitionNum: e.repetitionNum,
        clientTimestamp: BigInt(e.clientTimestamp),
        metadata: e.metadata || {},
      })),
    })

    return NextResponse.json({ success: true, inserted: result.count })
  } catch (err) {
    console.error('Failed to insert events:', err)
    return NextResponse.json(
      { error: 'Internal server error', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
