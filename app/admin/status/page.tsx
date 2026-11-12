import { prisma } from '@/app/lib/prisma'
import { ensureAdmin } from '@/app/lib/auth'
import ParticipantStatusAudit from '@/app/components/admin/ParticipantStatusAudit'

export default async function AdminStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ participantId?: string; id?: string }>
}) {
  await ensureAdmin()
  const { participantId, id } = await searchParams
  const targetId = participantId || id

  // Find all distinct participants who have sessions
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { participantId: { not: null } },
        { participantName: { not: null } },
      ],
    },
    select: {
      id: true,
      participantId: true,
      participantName: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Group by unique participant identifier
  const participantMap = new Map<string, { id: string; name: string; sessionCount: number }>()

  for (const s of sessions) {
    const key = s.participantId || s.participantName
    if (!key) continue

    if (!participantMap.has(key)) {
      participantMap.set(key, {
        id: key,
        name: s.participantName ? `${s.participantName} (${s.participantId || 'Tanpa ID'})` : key,
        sessionCount: 1,
      })
    } else {
      participantMap.get(key)!.sessionCount += 1
    }
  }

  const participants = Array.from(participantMap.values())

  return (
    <ParticipantStatusAudit
      participants={participants}
      initialParticipantId={targetId}
    />
  )
}
