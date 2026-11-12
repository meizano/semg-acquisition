import { prisma } from '@/app/lib/prisma'
import { notFound } from 'next/navigation'
import SessionController from '@/app/components/admin/SessionController'

export default async function AdminSessionDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const { id } = await params

  // Mengambil data sesi secara detail dari PostgreSQL
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      gesture: true,
      config: true,
    },
  })

  // Jika ID sesi tidak ditemukan di database
  if (!session) {
    notFound()
  }

  // Find sessions belonging to the same creation batch (created within ±3 minutes of this session)
  const batchSessions = await prisma.session.findMany({
    where: {
      ...(session.participantId
        ? { participantId: session.participantId }
        : session.participantName
        ? { participantName: session.participantName }
        : { id: session.id }),
      createdAt: {
        gte: new Date(session.createdAt.getTime() - 3 * 60 * 1000),
        lte: new Date(session.createdAt.getTime() + 3 * 60 * 1000),
      },
    },
    include: { gesture: true },
    orderBy: { createdAt: 'asc' },
  })

  // Sort strictly by gesture sequence order (1: Telunjuk Atas, 2: Telunjuk Tengah, ..., 12: Kelingking Bawah)
  batchSessions.sort((a, b) => (a.gesture?.orderIndex ?? 0) - (b.gesture?.orderIndex ?? 0))

  const currentIndex = batchSessions.findIndex((s) => s.id === session.id)
  const gestureIndex = currentIndex !== -1 ? currentIndex + 1 : 1
  const totalGestures = Math.max(1, batchSessions.length)
  const completedGesturesCount = batchSessions.filter((s) => s.status === 'completed').length
  const nextSessionId = currentIndex !== -1 && currentIndex + 1 < batchSessions.length ? batchSessions[currentIndex + 1].id : null
  const prevSessionId = currentIndex > 0 ? batchSessions[currentIndex - 1].id : null

  return (
    <div className="container mx-auto py-10 flex justify-center">
      {/* Memanggil Panel Kontrol Peneliti */}
      <SessionController 
        sessionId={session.id}
        gestureName={session.gesture.name}
        gestureLabel={session.gesture.label}
        participantName={session.participantName}
        config={{
          preparationDuration: session.config.preparationDuration,
          actionDuration: session.config.actionDuration,
          restDuration: session.config.restDuration,
          repetitionCount: session.config.repetitionCount
        }}
        sequence={{
          currentGestureIndex: gestureIndex,
          totalGestures,
          completedGestures: completedGesturesCount,
          nextSessionId,
          prevSessionId,
        }}
      />
    </div>
  )
}