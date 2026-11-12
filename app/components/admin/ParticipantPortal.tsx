'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { formatGender, formatDominantHand } from '@/app/lib/export'
import {
  Sun,
  Moon,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Search,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Calendar,
  Activity,
  Layers,
  ChevronRight,
  Loader2,
} from 'lucide-react'

interface ParticipantItem {
  key: string
  name: string
  id: string | null
  totalSessions: number
  completedSessions: number
  pagiCount: number
  soreCount: number
  lastActivity: string
}

interface GestureItem {
  gestureId: string
  orderIndex: number
  gestureName: string
  gestureLabel: string
  timeSlot: 'PAGI' | 'SORE'
  hasSession: boolean
  sessionId: string | null
  status: 'completed' | 'running' | 'pending' | 'aborted' | 'not_created'
  emgCount: number
  eventCount: number
  createdAtWib: string | null
  completedAtWib: string | null
}

interface ParticipantDetail {
  participant: {
    name: string
    id: string | null
    age?: number | null
    gender?: string | null
    dominantHand?: string | null
    condition?: string | null
  }
  config: {
    minRestIntervalHours: number
    morningCutoffHour: number
  }
  restInterval: {
    hasMorningSession: boolean
    lastPagiCompletedAt: string | null
    lastPagiCompletedAtWib: string | null
    firstSoreStartedAt: string | null
    firstSoreStartedAtWib: string | null
    restIntervalHours: number | null
    isMet: boolean
    remainingMinutes: number
  }
  summary: {
    targetTotal: number
    totalCompleted: number
    totalProgressPct: number
    pagiTarget: number
    pagiCompleted: number
    soreTarget: number
    soreCompleted: number
  }
  pagiGestures: GestureItem[]
  soreGestures: GestureItem[]
}

export default function ParticipantPortal({ initialQuery }: { initialQuery?: string }) {
  const [participants, setParticipants] = useState<ParticipantItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [searchTerm, setSearchTerm] = useState(initialQuery || '')
  const [selectedKey, setSelectedKey] = useState<string | null>(initialQuery || null)
  const [detail, setDetail] = useState<ParticipantDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [isPending, startTransition] = useTransition()

  // 1. Fetch participants list on mount
  const loadParticipantList = () => {
    setLoadingList(true)
    fetch('/api/participants/list')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setParticipants(data)
        if (!selectedKey && data.length > 0 && !initialQuery) {
          setSelectedKey(data[0].key)
          setSearchTerm(data[0].name)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    loadParticipantList()
  }, [])

  // 2. Fetch selected participant details
  useEffect(() => {
    if (!selectedKey) return
    setLoadingDetail(true)
    fetch(`/api/participants/${encodeURIComponent(selectedKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false))
  }, [selectedKey])

  // Filtered participants list for search
  const filteredParticipants = useMemo(() => {
    if (!searchTerm.trim()) return participants
    const q = searchTerm.toLowerCase()
    return participants.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.id && p.id.toLowerCase().includes(q)) ||
        p.key.toLowerCase().includes(q)
    )
  }, [participants, searchTerm])

  function handleSelectParticipant(key: string, name?: string) {
    setSelectedKey(key)
    setSearchTerm(name || key)
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = searchTerm.trim()
    if (!q) return

    // If there's an exact or partial match in filtered list, select it
    if (filteredParticipants.length > 0) {
      const exactMatch = filteredParticipants.find(
        (p) =>
          p.name.toLowerCase() === q.toLowerCase() ||
          (p.id && p.id.toLowerCase() === q.toLowerCase())
      )
      const target = exactMatch || filteredParticipants[0]
      handleSelectParticipant(target.key, target.name)
    } else {
      // Direct query to API
      setSelectedKey(q)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Layers className="text-teal-400" size={26} />
              Rekap 24 Gesture Partisipan
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
              12 Pagi + 12 Sore
            </span>
          </div>
          <p className="mt-1 text-sm text-white/70">
            Kelola dan pantau kelengkapan 24 gesture per orang (Sesi Pagi vs Sesi Sore) serta jeda istirahat otot.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/sessions/new"
            className="btn btn-primary text-xs flex items-center gap-1.5 shadow-lg"
          >
            + Buat Sesi Baru
          </Link>
          <Link
            href="/admin/sessions"
            className="btn btn-ghost text-xs border border-white/15 text-white/80 hover:text-white"
          >
            Riwayat Sesi
          </Link>
        </div>
      </div>

      {/* Search & Selector Card */}
      <div className="glass-card p-4 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              className="input pl-10 text-sm font-medium w-full"
              placeholder="Cari nama atau ID partisipan (contoh: 'Ridha', '1', 'fathan', 'Vatma')..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary text-xs px-4 py-2.5 flex items-center gap-1.5 font-bold shadow-md"
          >
            <Search size={14} />
            Cari
          </button>
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('')
                setSelectedKey(null)
                setDetail(null)
              }}
              className="btn btn-ghost text-xs px-3 text-white/60 hover:text-white"
            >
              Reset
            </button>
          )}
        </form>

        {/* Quick select chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin">
          <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider whitespace-nowrap">
            Partisipan:
          </span>
          {loadingList ? (
            <span className="text-xs text-white/50 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Memuat daftar partisipan...
            </span>
          ) : filteredParticipants.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>
                Tidak ada di filter cepat. Tekan <strong>Enter</strong> atau klik <strong>Cari</strong> untuk mencari di database.
              </span>
              <button
                type="button"
                onClick={loadParticipantList}
                className="text-teal-400 hover:text-teal-300 underline font-semibold ml-2"
              >
                Muat Ulang
              </button>
            </div>
          ) : (
            filteredParticipants.slice(0, 15).map((p) => {
              const isSelected = selectedKey === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleSelectParticipant(p.key, p.name)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap border ${
                    isSelected
                      ? 'bg-teal-500/20 border-teal-400 text-teal-300 shadow-md ring-1 ring-teal-400/40'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <User size={13} className={isSelected ? 'text-teal-300' : 'text-white/40'} />
                  <span>{p.name}</span>
                  <span className="text-[10px] opacity-60">({p.totalSessions})</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Loading state for detail */}
      {loadingDetail && (
        <div className="glass-card p-12 text-center flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
          <p className="text-sm font-medium text-white/80">
            Mengagregasi 24 gesture (12 Pagi & 12 Sore) untuk {selectedKey}...
          </p>
        </div>
      )}

      {/* Detail View */}
      {!loadingDetail && detail && (
        <div className="space-y-6">
          {/* Profile & Total Progress Card */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Bio details */}
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500/30 to-emerald-500/10 border border-teal-400/40 flex items-center justify-center shrink-0 shadow-lg">
                  <User size={24} className="text-teal-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-white">{detail.participant.name}</h2>
                    {detail.participant.id && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-white/10 text-teal-300 border border-white/15">
                        ID: {detail.participant.id}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-white/70 font-medium">
                    {detail.participant.age && <span>{detail.participant.age} Tahun</span>}
                    {detail.participant.gender && <span>• {formatGender(detail.participant.gender)}</span>}
                    {detail.participant.dominantHand && (
                      <span>• Tangan {formatDominantHand(detail.participant.dominantHand)}</span>
                    )}
                    {detail.participant.condition && (
                      <span className="text-amber-300">• {detail.participant.condition}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 24-Gesture Overall Gauge */}
              <div className="bg-black/30 p-3.5 rounded-2xl border border-white/10 flex items-center gap-5 shrink-0">
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-extrabold text-white/60">
                    Progres Keseluruhan
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-2xl font-black text-white font-mono">
                      {detail.summary.totalCompleted}
                    </span>
                    <span className="text-sm font-bold text-white/60">
                      / {detail.summary.targetTotal} Gesture
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xl font-black text-teal-300 font-mono">
                    {detail.summary.totalProgressPct}%
                  </div>
                  <span
                    className={`inline-block text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full mt-0.5 ${
                      detail.summary.totalCompleted === 24
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {detail.summary.totalCompleted === 24 ? '24 Selesai Lengkap' : 'Belum Lengkap'}
                  </span>
                </div>
              </div>
            </div>

            {/* Smart Inter-Session Rest Interval Guard */}
            {detail.restInterval.hasMorningSession ? (
              <div
                className={`p-4 rounded-2xl border text-xs space-y-1.5 transition-all ${
                  detail.restInterval.isMet
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-sm uppercase tracking-wide">
                    {detail.restInterval.isMet ? (
                      <>
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        <span className="text-emerald-300">
                          Jeda Istirahat Otot Terpenuhi (≥ {detail.config.minRestIntervalHours} Jam)
                        </span>
                      </>
                    ) : (
                      <>
                        <Clock size={18} className="text-amber-400 animate-pulse" />
                        <span className="text-amber-300">
                          Masa Pemulihan Otot (Belum Cukup {detail.config.minRestIntervalHours} Jam)
                        </span>
                      </>
                    )}
                  </div>

                  <span className="font-mono font-black text-sm px-2.5 py-0.5 rounded-lg bg-black/40">
                    Jeda: {detail.restInterval.restIntervalHours ?? 0} Jam
                  </span>
                </div>

                <p className="text-white/80 font-medium">
                  {detail.restInterval.isMet
                    ? `Sesi pagi selesai pada ${detail.restInterval.lastPagiCompletedAtWib}. Partisipan telah istirahat selama ${detail.restInterval.restIntervalHours} jam dan siap untuk Sesi Sore.`
                    : `Sesi pagi selesai pada ${detail.restInterval.lastPagiCompletedAtWib}. Jeda istirahat baru ${detail.restInterval.restIntervalHours} jam (kurang dari syarat baku ${detail.config.minRestIntervalHours} jam). Sisa waktu istirahat yang disarankan: ${Math.floor(detail.restInterval.remainingMinutes / 60)} jam ${detail.restInterval.remainingMinutes % 60} menit lagi.`}
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-xs text-white/70 flex items-center gap-2.5">
                <Clock size={16} className="text-white/40 shrink-0" />
                <span>
                  Partisipan belum memiliki rekaman Sesi Pagi. Sesi Sore tetap dapat dimulai kapan saja sesuai kebutuhan operator.
                </span>
              </div>
            )}
          </div>

          {/* Dual Column Layout: Sesi Pagi vs Sesi Sore */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ☀️ Kolom 1: Sesi Pagi */}
            <div className="glass-card p-5 space-y-4 border-t-4 border-amber-400/80">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                    <Sun size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white">Sesi Pagi</h3>
                    <p className="text-[11px] text-white/60">
                      Sebelum pukul {detail.config.morningCutoffHour}:00 WIB
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono text-sm font-black text-amber-300">
                    {detail.summary.pagiCompleted} / {detail.summary.pagiTarget}
                  </span>
                  <span className="block text-[10px] font-bold text-white/50 uppercase">
                    Gesture Selesai
                  </span>
                </div>
              </div>

              {/* Quick Actions Pagi */}
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/sessions/new?participantId=${encodeURIComponent(
                    detail.participant.id || ''
                  )}&participantName=${encodeURIComponent(
                    detail.participant.name
                  )}&sessionTime=PAGI`}
                  className="btn btn-primary text-xs py-2 px-3 flex-1 flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Sun size={14} />
                  + Buat Sesi Pagi
                </Link>

                <Link
                  href={`/admin/status?id=${encodeURIComponent(
                    detail.participant.id || detail.participant.name
                  )}`}
                  target="_blank"
                  className="btn btn-secondary text-xs py-2 px-3 flex items-center gap-1 border border-teal-500/30 text-teal-300"
                  title="Lihat Audit Sinyal"
                >
                  <Activity size={14} />
                  Audit Sinyal
                </Link>
              </div>

              {/* 12 Gestures List Pagi */}
              <div className="space-y-2">
                {detail.pagiGestures.map((g) => (
                  <div
                    key={g.gestureId}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between hover:bg-white/10 transition-all text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-black/40 border border-white/20 flex items-center justify-center text-[10px] font-black text-amber-300">
                        {g.orderIndex}
                      </span>
                      <div>
                        <span className="font-bold text-white block">{g.gestureLabel}</span>
                        {g.completedAtWib && (
                          <span className="text-[10px] text-white/50">{g.completedAtWib}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {g.hasSession ? (
                        <>
                          <span
                            className={`badge ${
                              g.status === 'completed'
                                ? 'badge-success'
                                : g.status === 'running'
                                ? 'badge-info'
                                : 'badge-warning'
                            }`}
                          >
                            {g.status === 'completed'
                              ? 'Selesai ✅'
                              : g.status === 'running'
                              ? 'Berjalan ⚡'
                              : 'Menunggu'}
                          </span>
                          {g.emgCount > 0 && (
                            <span className="text-[10px] font-mono text-teal-300 font-bold">
                              {g.emgCount.toLocaleString('id-ID')} EMG
                            </span>
                          )}
                          <Link
                            href={`/admin/sessions/${g.sessionId}`}
                            className="text-white/60 hover:text-white p-1"
                            title="Buka Sesi"
                          >
                            <ExternalLink size={13} />
                          </Link>
                        </>
                      ) : (
                        <span className="text-[11px] text-white/40 italic">Belum Ada Sesi</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ⛅ Kolom 2: Sesi Sore */}
            <div className="glass-card p-5 space-y-4 border-t-4 border-indigo-400/80">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
                    <Moon size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white">Sesi Sore</h3>
                    <p className="text-[11px] text-white/60">
                      Sesudah pukul {detail.config.morningCutoffHour}:00 WIB
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono text-sm font-black text-indigo-300">
                    {detail.summary.soreCompleted} / {detail.summary.soreTarget}
                  </span>
                  <span className="block text-[10px] font-bold text-white/50 uppercase">
                    Gesture Selesai
                  </span>
                </div>
              </div>

              {/* Quick Actions Sore */}
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/sessions/new?participantId=${encodeURIComponent(
                    detail.participant.id || ''
                  )}&participantName=${encodeURIComponent(
                    detail.participant.name
                  )}&sessionTime=SORE`}
                  className={`btn text-xs py-2 px-3 flex-1 flex items-center justify-center gap-1.5 shadow-md ${
                    detail.restInterval.hasMorningSession && !detail.restInterval.isMet
                      ? 'bg-amber-500 hover:bg-amber-600 text-black font-extrabold'
                      : 'btn-primary'
                  }`}
                >
                  <Moon size={14} />
                  + Buat Sesi Sore
                </Link>

                <Link
                  href={`/admin/status?id=${encodeURIComponent(
                    detail.participant.id || detail.participant.name
                  )}`}
                  target="_blank"
                  className="btn btn-secondary text-xs py-2 px-3 flex items-center gap-1 border border-teal-500/30 text-teal-300"
                  title="Lihat Audit Sinyal"
                >
                  <Activity size={14} />
                  Audit Sinyal
                </Link>
              </div>

              {/* 12 Gestures List Sore */}
              <div className="space-y-2">
                {detail.soreGestures.map((g) => (
                  <div
                    key={g.gestureId}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between hover:bg-white/10 transition-all text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-black/40 border border-white/20 flex items-center justify-center text-[10px] font-black text-indigo-300">
                        {g.orderIndex}
                      </span>
                      <div>
                        <span className="font-bold text-white block">{g.gestureLabel}</span>
                        {g.completedAtWib && (
                          <span className="text-[10px] text-white/50">{g.completedAtWib}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {g.hasSession ? (
                        <>
                          <span
                            className={`badge ${
                              g.status === 'completed'
                                ? 'badge-success'
                                : g.status === 'running'
                                ? 'badge-info'
                                : 'badge-warning'
                            }`}
                          >
                            {g.status === 'completed'
                              ? 'Selesai ✅'
                              : g.status === 'running'
                              ? 'Berjalan ⚡'
                              : 'Menunggu'}
                          </span>
                          {g.emgCount > 0 && (
                            <span className="text-[10px] font-mono text-teal-300 font-bold">
                              {g.emgCount.toLocaleString('id-ID')} EMG
                            </span>
                          )}
                          <Link
                            href={`/admin/sessions/${g.sessionId}`}
                            className="text-white/60 hover:text-white p-1"
                            title="Buka Sesi"
                          >
                            <ExternalLink size={13} />
                          </Link>
                        </>
                      ) : (
                        <span className="text-[11px] text-white/40 italic">Belum Ada Sesi</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loadingDetail && !detail && selectedKey && (
        <div className="glass-card p-12 text-center space-y-3">
          <User size={36} className="mx-auto text-white/30" />
          <h3 className="text-base font-bold text-white">
            Belum ada sesi untuk &quot;{selectedKey}&quot;
          </h3>
          <p className="text-xs text-white/60 max-w-sm mx-auto">
            Partisipan ini belum memiliki sesi yang tercatat di sistem. Anda dapat membuat sesi baru untuk partisipan ini.
          </p>
          <Link
            href={`/admin/sessions/new?participantName=${encodeURIComponent(selectedKey)}`}
            className="btn btn-primary text-xs inline-flex items-center gap-1.5 mt-2"
          >
            + Buat Sesi untuk Partisipan Ini
          </Link>
        </div>
      )}
    </div>
  )
}
