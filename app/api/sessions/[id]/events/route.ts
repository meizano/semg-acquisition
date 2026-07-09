import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

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
