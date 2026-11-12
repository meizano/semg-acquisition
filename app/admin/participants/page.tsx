import { ensureAdmin } from '@/app/lib/auth'
import ParticipantPortal from '@/app/components/admin/ParticipantPortal'

export default async function AdminParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; name?: string }>
}) {
  await ensureAdmin()
  const { id, name } = await searchParams
  const query = id || name || ''

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <ParticipantPortal initialQuery={query} />
    </div>
  )
}
