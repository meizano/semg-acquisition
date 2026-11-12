import { prisma } from '@/app/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const sessions = await prisma.session.findMany({
    include: { gesture: true, config: true, _count: { select: { events: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(sessions)
}

export async function POST(request: Request) {
  const body = await request.json()

  let config = await prisma.sessionConfig.findFirst({ where: { isActive: true } })
  if (!config) {
    config = await prisma.sessionConfig.create({
      data: {
        name: 'Default',
        preparationDuration: 3,
        actionDuration: 5,
        restDuration: 3,
        repetitionCount: 10,
        isActive: true,
      },
    })
  }

  const gestureIds: string[] = Array.isArray(body.gestureIds) && body.gestureIds.length > 0
    ? body.gestureIds
    : body.gestureId
    ? [body.gestureId]
    : []

  if (gestureIds.length === 0) {
    return NextResponse.json({ error: 'Minimal pilih 1 gesture' }, { status: 400 })
  }

  // Fetch gestures sorted strictly by orderIndex (1: Telunjuk Atas, 2: Telunjuk Tengah, etc.)
  const targetGestures = await prisma.gesture.findMany({
    where: { id: { in: gestureIds } },
    orderBy: { orderIndex: 'asc' },
  })

  const currentWibHour = (new Date().getUTCHours() + 7) % 24
  const cutoff = config.morningCutoffHour ?? 12
  const determinedSessionTime = body.sessionTime === 'PAGI' || body.sessionTime === 'SORE'
    ? body.sessionTime
    : currentWibHour < cutoff ? 'PAGI' : 'SORE'

  const commonData = {
    configId: config.id,
    participantId: body.participantId || null,
    participantName: body.participantName || null,
    age: body.age ? parseInt(body.age) : null,
    gender: body.gender || null,
    dominantHand: body.dominantHand || null,
    condition: body.condition || null,
    sessionTime: determinedSessionTime,
  }

  const createdSessions = []
  for (const g of targetGestures) {
    const s = await prisma.session.create({
      data: {
        ...commonData,
        gestureId: g.id,
      },
      include: { gesture: true, config: true },
    })
    createdSessions.push(s)
  }

  // Returns single session object or first session with array for backward compatibility
  const first = createdSessions[0]
  return NextResponse.json(
    {
      ...first,
      sessions: createdSessions,
      sessionIds: createdSessions.map((s) => s.id),
      totalCreated: createdSessions.length,
    },
    { status: 201 }
  )
}
