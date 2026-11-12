import { prisma } from '@/app/lib/prisma'
import SessionHistory from '@/app/components/admin/SessionHistory'

export default async function SessionsPage() {
  const sessions = await prisma.session.findMany({
    include: {
      gesture: true,
      config: true,
      _count: { select: { events: true, emgRecords: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const serialized = sessions.map((s) => ({
    id: s.id,
    participantId: s.participantId,
    participantName: s.participantName,
    age: s.age,
    gender: s.gender,
    dominantHand: s.dominantHand,
    condition: s.condition,
    status: s.status,
    gestureName: s.gesture.name,
    gestureLabel: s.gesture.label,
    sessionTime: s.sessionTime || 'PAGI',
    configName: s.config.name,
    eventCount: s._count.events,
    emgCount: s._count.emgRecords,
    startedAt: s.startedAt?.toISOString() || null,
    completedAt: s.completedAt?.toISOString() || null,
    createdAt: s.createdAt.toISOString(),
  }))

  return <SessionHistory sessions={serialized} />
}
