'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Hand, Check, CheckSquare, Square, ListOrdered } from 'lucide-react'

interface Gesture {
  id: string
  name: string
  label: string
  description: string | null
  videoUrl: string | null
  orderIndex: number
}

interface Config {
  id: string
  name: string
  preparationDuration: number
  actionDuration: number
  restDuration: number
  repetitionCount: number
  morningCutoffHour?: number
  minRestIntervalHours?: number
}

export default function SessionCreator({
  gestures,
  config,
}: {
  gestures: Gesture[]
  config: Config | null
}) {
  const router = useRouter()
  // Ensure gestures are strictly sorted by orderIndex
  const sortedGestures = useMemo(() => {
    return [...gestures].sort((a, b) => a.orderIndex - b.orderIndex)
  }, [gestures])

  // Detect current WIB hour: < morningCutoffHour is PAGI, >= is SORE
  const currentHour = (new Date().getUTCHours() + 7) % 24
  const defaultSessionTime = currentHour < (config?.morningCutoffHour ?? 12) ? 'PAGI' : 'SORE'

  const [selectedGestures, setSelectedGestures] = useState<string[]>([])
  const [sessionTime, setSessionTime] = useState<'PAGI' | 'SORE'>(defaultSessionTime)
  const [participantId, setParticipantId] = useState('')
  const [participantName, setParticipantName] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [dominantHand, setDominantHand] = useState('')
  const [condition, setCondition] = useState('')
  const [loading, setLoading] = useState(false)

  const isAllSelected = sortedGestures.length > 0 && selectedGestures.length === sortedGestures.length

  function toggleGesture(id: string) {
    setSelectedGestures(prev => {
      const next = prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]
      return next.sort((a, b) => {
        const ga = sortedGestures.find(g => g.id === a)?.orderIndex || 0
        const gb = sortedGestures.find(g => g.id === b)?.orderIndex || 0
        return ga - gb
      })
    })
  }

  function handleSelectAll() {
    if (isAllSelected) {
      setSelectedGestures([])
    } else {
      setSelectedGestures(sortedGestures.map(g => g.id))
    }
  }

  // Ordered list of selected gesture objects
  const orderedSelected = useMemo(() => {
    return selectedGestures
      .map(id => sortedGestures.find(g => g.id === id)!)
      .filter(Boolean)
  }, [selectedGestures, sortedGestures])

  async function createSession() {
    if (selectedGestures.length === 0) return
    setLoading(true)

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestureIds: selectedGestures,
          sessionTime,
          participantId: participantId || undefined,
          participantName: participantName || undefined,
          age: age || undefined,
          gender: gender || undefined,
          dominantHand: dominantHand || undefined,
          condition: condition || undefined,
        }),
      })

      if (!res.ok) throw new Error('Failed to create session')
      const data = await res.json()
      // Redirect to the first session created
      router.push(`/admin/sessions/${data.id}`)
    } catch {
      alert('Gagal membuat sesi. Coba lagi.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Buat Sesi Baru</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Isi data partisipan, pilih satu atau semua gesture sekaligus, lalu klik &quot;Buat Sesi&quot;
          </p>
        </div>
        <Link href="/admin/sessions" className="btn btn-ghost text-sm">
          ← Kembali ke Riwayat
        </Link>
      </div>

      {/* Config Info */}
      {config && (
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Konfigurasi Aktif:</span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{config.name}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              ({config.preparationDuration}s persiapan / {config.actionDuration}s aksi / {config.restDuration}s istirahat × {config.repetitionCount} repetisi)
            </span>
          </div>
          <Link href="/admin/config" className="text-xs" style={{ color: 'var(--color-accent)' }}>Ubah</Link>
        </div>
      )}

      {/* Participant Metadata Form */}
      <div className="glass-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Data Partisipan (Opsional)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">ID Partisipan / Kode</label>
            <input className="input" placeholder="e.g. SUBJ-001" value={participantId} onChange={(e) => setParticipantId(e.target.value)} />
          </div>
          <div>
            <label className="label">Nama / Inisial</label>
            <input className="input" placeholder="e.g. Budi S." value={participantName} onChange={(e) => setParticipantName(e.target.value)} />
          </div>
          <div>
            <label className="label">Umur (Tahun)</label>
            <input type="number" className="input" placeholder="e.g. 24" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div>
            <label className="label">Gender</label>
            <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Pilih Gender...</option>
              <option value="Male">Laki-laki</option>
              <option value="Female">Perempuan</option>
            </select>
          </div>
          <div>
            <label className="label">Dominan Tangan</label>
            <select className="input" value={dominantHand} onChange={(e) => setDominantHand(e.target.value)}>
              <option value="">Pilih Tangan...</option>
              <option value="Right">Kanan</option>
              <option value="Left">Kiri</option>
              <option value="Ambidextrous">Keduanya (Ambidextrous)</option>
            </select>
          </div>
          <div>
            <label className="label">Kondisi / Catatan Klinis</label>
            <input className="input" placeholder="e.g. Sehat, Myalgia" value={condition} onChange={(e) => setCondition(e.target.value)} />
          </div>
        </div>

        {/* Waktu Sesi (PAGI vs SORE) */}
        <div className="pt-3 border-t border-white/10">
          <label className="label">Waktu Sesi Eksperimen</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSessionTime('PAGI')}
              className={`p-3.5 rounded-xl border flex items-center justify-center gap-3 transition-all ${
                sessionTime === 'PAGI'
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-black shadow-lg ring-2 ring-amber-400/30'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="text-2xl">☀️</span>
              <div className="text-left">
                <div className="text-xs uppercase font-black tracking-wider">Sesi Pagi</div>
                <div className="text-[10px] font-medium opacity-70">Sebelum jam {config?.morningCutoffHour ?? 12}:00 WIB</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSessionTime('SORE')}
              className={`p-3.5 rounded-xl border flex items-center justify-center gap-3 transition-all ${
                sessionTime === 'SORE'
                  ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300 font-black shadow-lg ring-2 ring-indigo-400/30'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="text-2xl">⛅</span>
              <div className="text-left">
                <div className="text-xs uppercase font-black tracking-wider">Sesi Sore</div>
                <div className="text-[10px] font-medium opacity-70">Sesudah jam {config?.morningCutoffHour ?? 12}:00 WIB</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Gesture Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Pilih Gesture
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 font-medium">
              {selectedGestures.length} dari {sortedGestures.length} dipilih
            </span>
          </div>

          <button
            type="button"
            onClick={handleSelectAll}
            className="btn btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 border border-teal-500/30 hover:border-teal-400"
            style={{ color: 'var(--color-accent)' }}
          >
            {isAllSelected ? (
              <>
                <Square size={14} />
                Batal Pilih Semua
              </>
            ) : (
              <>
                <CheckSquare size={14} />
                Pilih Semua ({sortedGestures.length} Gesture)
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sortedGestures.map((g) => {
            const isSelected = selectedGestures.includes(g.id)
            const selectionIndex = orderedSelected.findIndex(s => s.id === g.id)

            return (
              <button
                key={g.id}
                type="button"
                className="glass-card p-4 text-left transition-all duration-200 relative group"
                onClick={() => toggleGesture(g.id)}
                style={{
                  borderColor: isSelected ? 'var(--color-accent)' : undefined,
                  boxShadow: isSelected ? '0 0 20px rgba(20, 184, 166, 0.25)' : undefined,
                  background: isSelected ? 'rgba(20, 184, 166, 0.08)' : undefined,
                }}
              >
                {/* Sequence Badge (Urutan #1..#12) */}
                <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-black/80 border border-teal-500/50 text-[11px] font-black text-teal-300 shadow-sm backdrop-blur-sm">
                  Urutan #{g.orderIndex}
                </div>

                {/* Selection Checkmark Badge */}
                <div
                  className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                    isSelected ? 'bg-teal-500 text-black shadow-md scale-100 font-black text-xs' : 'bg-black/50 text-white/30 border border-white/20 scale-90 opacity-70 group-hover:opacity-100'
                  }`}
                >
                  {isSelected ? (selectionIndex !== -1 ? selectionIndex + 1 : <Check size={14} strokeWidth={3} />) : <Check size={14} strokeWidth={3} />}
                </div>

                {g.videoUrl ? (
                  <div className="rounded-lg overflow-hidden mb-2 mt-4" style={{ aspectRatio: '16/10', background: '#000' }}>
                    <video src={g.videoUrl} className="w-full h-full object-cover" preload="metadata" muted />
                  </div>
                ) : (
                  <div className="rounded-lg mb-2 mt-4 flex items-center justify-center text-gray-500" style={{ aspectRatio: '16/10', background: 'var(--bg-primary)' }}>
                    <Hand strokeWidth={1.5} className="w-8 h-8 opacity-70" />
                  </div>
                )}
                <p className="text-sm font-semibold" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--text-primary)' }}>
                  {g.label}
                </p>
                <p className="text-xs mt-0.5 text-white/60">{g.name}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected & Create */}
      {selectedGestures.length > 0 && (
        <div className="sticky bottom-6 z-20 mt-8 animate-slide-up">
          <div className="glass-card p-5 glow-action space-y-4" style={{ boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-teal-400 font-bold">Gesture Terpilih</p>
                <p className="text-xl font-black mt-0.5 text-white">
                  {selectedGestures.length} Gesture akan dibuat
                </p>
                <p className="text-xs mt-0.5 text-white/80">
                  Sesi akan diurutkan secara otomatis (#1 s/d #{selectedGestures.length}) dan siap dijalankan berurutan
                </p>
              </div>
              <button className="btn btn-primary text-base px-8 py-3.5 shadow-xl font-extrabold text-white" onClick={createSession} disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Membuat Sesi...
                  </span>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                    Buat {selectedGestures.length} Sesi Berurutan
                  </>
                )}
              </button>
            </div>

            {/* Ordered Execution Preview */}
            <div className="p-3.5 bg-black/50 rounded-xl border border-white/10">
              <p className="text-xs uppercase tracking-wider font-extrabold text-teal-300 mb-2 flex items-center gap-1.5">
                <ListOrdered size={15} />
                Urutan Eksekusi Sesi ({orderedSelected.length} Gesture):
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                {orderedSelected.map((g, idx) => (
                  <div key={g.id} className="flex items-center gap-1.5 text-xs bg-white/10 px-2.5 py-1 rounded-lg border border-white/15">
                    <span className="w-5 h-5 rounded-full bg-teal-500 text-black font-black flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-white">{g.name}</span>
                    {idx < orderedSelected.length - 1 && (
                      <span className="text-teal-400/60 font-bold ml-1">➔</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

