'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatGender, formatDominantHand } from '@/app/lib/export'
import { 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  User, 
  RotateCcw, 
  FileSpreadsheet, 
  FileCode,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  X
} from 'lucide-react'

interface ParticipantOption {
  id: string
  name: string
  sessionCount: number
}

interface GestureAuditItem {
  gestureId: string
  orderIndex: number
  gestureName: string
  gestureLabel: string
  status: string
  sessionId: string | null
  targetActionDurationSec: number
  targetSamples: number
  actualActionSamples: number
  activeSamples: number
  idleSamples: number
  completenessPct: number
  activeSecondsCovered: number
  rating: 'EXCELLENT' | 'GOOD' | 'NEEDS_RETAKE' | 'MISSING'
  ratingLabel: string
  recommendation: string
}

interface AuditData {
  participant: {
    participantId: string | null
    participantName: string
    age: number | null
    gender: string | null
    dominantHand: string | null
    condition: string | null
  }
  summary: {
    totalGestures: number
    completedCount: number
    gestureProgressPct: number
    averageActionCompletenessPct: number
    lossPattern: {
      type: 'DISTRIBUTED_NORMAL' | 'CONCENTRATED_LOSS' | 'INCOMPLETE_GESTURES'
      title: string
      description: string
      problematicGestures: {
        orderIndex: number
        gestureName: string
        completenessPct: number
        sessionId: string | null
      }[]
    }
  }
  gestures: GestureAuditItem[]
}

export default function ParticipantStatusAudit({
  participants,
  initialParticipantId,
}: {
  participants: ParticipantOption[]
  initialParticipantId?: string
}) {
  const [selectedId, setSelectedId] = useState<string>(
    initialParticipantId || (participants.length > 0 ? participants[0].id : '')
  )
  const [auditData, setAuditData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retakeLoading, setRetakeLoading] = useState<string | null>(null)
  const [isDiagnosisExpanded, setIsDiagnosisExpanded] = useState(false)
  const [showDiagnosisModal, setShowDiagnosisModal] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    setIsDiagnosisExpanded(false)
    setShowDiagnosisModal(false)

    async function fetchAudit() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/audit/${encodeURIComponent(selectedId)}`)
        if (!res.ok) {
          throw new Error('Gagal memuat audit data partisipan')
        }
        const data = await res.json()
        setAuditData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
      } finally {
        setLoading(false)
      }
    }

    fetchAudit()
  }, [selectedId])

  async function handleRetake(gestureId: string, gestureName: string) {
    if (!auditData) return
    const conf = confirm(
      `Buat sesi baru untuk pengambilan ulang (Retake) gesture "${gestureName}" dengan biodata partisipan ${auditData.participant.participantName}?`
    )
    if (!conf) return

    setRetakeLoading(gestureId)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestureIds: [gestureId],
          participantId: auditData.participant.participantId || undefined,
          participantName: auditData.participant.participantName !== '-' ? auditData.participant.participantName : undefined,
          age: auditData.participant.age || undefined,
          gender: auditData.participant.gender || undefined,
          dominantHand: auditData.participant.dominantHand || undefined,
          condition: auditData.participant.condition || undefined,
        }),
      })

      if (!res.ok) throw new Error('Gagal membuat sesi retake')
      const created = await res.json()
      window.location.href = `/admin/sessions/${created.id}`
    } catch {
      alert('Gagal membuat sesi retake. Coba lagi.')
      setRetakeLoading(null)
    }
  }

  function downloadExport(sessionId: string, format: 'csv' | 'json') {
    window.open(`/api/sessions/${sessionId}/events?format=${format}`, '_blank')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Activity className="text-teal-400 w-7 h-7" />
            Audit Status Akhir & Kelengkapan Sinyal
          </h1>
          <p className="text-sm mt-1 text-white/80">
            Pengecekan kontinuitas sinyal fase ACTION per detik (@200Hz) dan deteksi anomali pada 12 gesture
          </p>
        </div>

        {/* Participant Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase font-extrabold text-white/80 whitespace-nowrap">
            Pilih Partisipan:
          </label>
          <select
            className="input min-w-[220px] text-sm font-bold text-white bg-black/50 border-teal-500/30"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sessionCount} Sesi)
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="glass-card p-12 text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-teal-400 mb-3" />
          <p className="text-base font-bold text-white">Menganalisis data rekaman sEMG...</p>
        </div>
      )}

      {error && (
        <div className="glass-card p-8 text-center border border-red-500/40 bg-red-500/10">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-2" />
          <p className="text-base font-bold text-white">{error}</p>
        </div>
      )}

      {!loading && !error && auditData && (
        <>
          {/* Participant Info Banner */}
          <div className="glass-card p-5 border border-white/10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-300">
                <User size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-white">{auditData.participant.participantName}</h2>
                  {auditData.participant.participantId && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 font-mono font-bold text-teal-300 border border-white/15">
                      {auditData.participant.participantId}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/70 mt-1">
                  <span>Usia: <strong className="text-white">{auditData.participant.age ? `${auditData.participant.age} th` : '-'}</strong></span>
                  <span>Gender: <strong className="text-white">{formatGender(auditData.participant.gender)}</strong></span>
                  <span>Tangan: <strong className="text-white">{formatDominantHand(auditData.participant.dominantHand)}</strong></span>
                  <span>Kondisi: <strong className="text-white">{auditData.participant.condition || '-'}</strong></span>
                </div>
              </div>
            </div>

            <Link href="/admin/sessions/new" className="btn btn-primary text-xs py-2 px-4 flex items-center gap-1.5 text-white font-bold">
              + Buat Sesi Baru
            </Link>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Card 1: Kelengkapan Gesture */}
            <div className="glass-card p-5 border border-white/10 flex flex-col justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-extrabold text-white/70">Kelengkapan 12 Gesture</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black text-white">
                    {auditData.summary.completedCount}
                  </span>
                  <span className="text-sm font-bold text-white/60">/ {auditData.summary.totalGestures} Gesture</span>
                  <span className="ml-auto text-sm font-black text-teal-400">
                    {auditData.summary.gestureProgressPct}%
                  </span>
                </div>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 mt-3 overflow-hidden">
                <div 
                  className="bg-teal-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${auditData.summary.gestureProgressPct}%` }}
                />
              </div>
            </div>

            {/* Card 2: Rata-Rata Sinyal ACTION */}
            <div className="glass-card p-5 border border-white/10 flex flex-col justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-extrabold text-white/70">Rata-Rata Keaktifan ACTION</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black text-white">
                    {auditData.summary.averageActionCompletenessPct}%
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-black ml-auto ${
                    auditData.summary.averageActionCompletenessPct >= 90 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                      : auditData.summary.averageActionCompletenessPct >= 75
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    {auditData.summary.averageActionCompletenessPct >= 90 ? 'DATA SIAP' : auditData.summary.averageActionCompletenessPct >= 75 ? 'CUKUP' : 'PERLU PERBAIKAN'}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-white/60 mt-3">
                Dihitung dari rasio sampel aktif (&gt;10 ADC) terhadap target 200 data/detik
              </p>
            </div>

            {/* Card 3: Status Pola Sinyal (Clickable & Expandable) */}
            <div 
              role="button"
              tabIndex={0}
              onClick={() => setIsDiagnosisExpanded((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setIsDiagnosisExpanded((prev) => !prev)
                }
              }}
              className={`glass-card p-5 border flex flex-col justify-between cursor-pointer transition-all duration-300 relative group select-none ${
                auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL'
                  ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-400/80 hover:bg-emerald-500/10'
                  : auditData.summary.lossPattern.type === 'CONCENTRATED_LOSS'
                  ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400/80 hover:bg-amber-500/10'
                  : 'border-rose-500/40 bg-rose-500/5 hover:border-rose-400/80 hover:bg-rose-500/10'
              } ${isDiagnosisExpanded ? 'ring-2 ring-teal-400/50 shadow-xl' : 'hover:shadow-md'}`}
              title="Klik card untuk melihat seluruh tulisan diagnosa"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL' ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <p className="text-xs uppercase tracking-wider font-extrabold text-white">
                      Diagnosa Pola Data
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowDiagnosisModal(true)
                      }}
                      className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-all"
                      title="Buka dialog diagnosa terfokus"
                    >
                      <Maximize2 size={13} />
                    </button>
                    <span className="text-white/60 group-hover:text-white transition-colors">
                      {isDiagnosisExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </div>
                </div>

                <p className="text-sm font-extrabold text-white mt-1.5">
                  {auditData.summary.lossPattern.title}
                </p>
              </div>

              <div className="mt-2.5">
                <p className={`text-xs text-white/90 leading-relaxed transition-all duration-300 ${
                  isDiagnosisExpanded ? 'line-clamp-none' : 'line-clamp-2'
                }`}>
                  {auditData.summary.lossPattern.description}
                </p>

                {/* Daftar gesture bermasalah jika card dibuka */}
                {isDiagnosisExpanded && auditData.summary.lossPattern.problematicGestures?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                    <span className="text-[11px] font-bold text-amber-300 block uppercase tracking-wider">
                      Gesture Terindikasi Anomali:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {auditData.summary.lossPattern.problematicGestures.map((pg) => (
                        <span 
                          key={pg.orderIndex}
                          className="px-2 py-0.5 rounded-md bg-black/40 border border-amber-500/30 text-[11px] font-medium text-amber-200"
                        >
                          #{pg.orderIndex} {pg.gestureName} ({pg.completenessPct}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-bold tracking-wider uppercase">
                  <span className={`${
                    auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL'
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  } flex items-center gap-1`}>
                    {isDiagnosisExpanded ? (
                      <>Tutup diagnosa lengkap <ChevronUp size={11} /></>
                    ) : (
                      <>Klik untuk baca selengkapnya <ChevronDown size={11} /></>
                    )}
                  </span>
                  <span className="text-white/40 text-[9px] font-normal">Klik Card</span>
                </div>
              </div>
            </div>
          </div>

          {/* Table of 12 Gestures */}
          <div className="glass-card overflow-hidden border border-white/10">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Rincian Kelengkapan 12 Gesture</h3>
                <p className="text-xs text-white/60">Urutan baku #1 Telunjuk Atas s/d #12 Kelingking Bawah</p>
              </div>
              <span className="text-xs text-teal-300 font-bold bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20">
                Ambang batas aktif: &gt; 10 ADC (Filter Butterworth + Kalman)
              </span>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Urutan</th>
                    <th>Nama Gesture</th>
                    <th>Status Sesi</th>
                    <th>Durasi ACTION</th>
                    <th>Sampel Aktif / Target</th>
                    <th>Kelengkapan</th>
                    <th>Diagnosa</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.gestures.map((g) => {
                    const isExcellent = g.rating === 'EXCELLENT'
                    const isGood = g.rating === 'GOOD'
                    const isRetake = g.rating === 'NEEDS_RETAKE'
                    const isMissing = g.rating === 'MISSING'

                    return (
                      <tr key={g.gestureId}>
                        <td>
                          <span className="w-6 h-6 rounded-md bg-white/10 font-mono font-black text-xs text-teal-300 flex items-center justify-center border border-white/15">
                            #{g.orderIndex}
                          </span>
                        </td>
                        <td>
                          <div>
                            <span className="font-bold text-sm text-white">{g.gestureLabel}</span>
                            <p className="text-xs text-white/50">{g.gestureName}</p>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${
                            g.status === 'completed' ? 'badge-success' :
                            g.status === 'running' ? 'badge-info' :
                            g.status === 'aborted' ? 'badge-danger' : 'badge-neutral'
                          }`}>
                            {g.status === 'completed' ? 'Selesai' : g.status}
                          </span>
                        </td>
                        <td className="text-white/80 font-mono text-xs">
                          {g.targetActionDurationSec > 0 ? `${g.targetActionDurationSec}s target` : '-'}
                        </td>
                        <td>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white font-mono">
                              {g.activeSamples.toLocaleString('id-ID')} / {g.targetSamples.toLocaleString('id-ID')}
                            </span>
                            <span className="text-[10px] text-white/50">
                              {g.idleSamples > 0 ? `${g.idleSamples} noise (≤10)` : '0 noise'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isExcellent ? 'bg-emerald-400' : isGood ? 'bg-amber-400' : 'bg-rose-500'
                                }`}
                                style={{ width: `${g.completenessPct}%` }}
                              />
                            </div>
                            <span className={`text-xs font-black font-mono ${
                              isExcellent ? 'text-emerald-300' : isGood ? 'text-amber-300' : 'text-rose-400'
                            }`}>
                              {g.completenessPct}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`text-xs font-extrabold px-2 py-0.5 rounded ${
                            isExcellent ? 'bg-emerald-500/20 text-emerald-300' :
                            isGood ? 'bg-amber-500/20 text-amber-300' :
                            'bg-rose-500/20 text-rose-300'
                          }`}>
                            {g.ratingLabel}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            {g.sessionId && (
                              <>
                                <button
                                  className="btn btn-ghost text-xs py-1 px-2 text-white/70 hover:text-white"
                                  onClick={() => downloadExport(g.sessionId!, 'csv')}
                                  title="Export CSV"
                                >
                                  <FileSpreadsheet size={14} />
                                </button>
                                <button
                                  className="btn btn-ghost text-xs py-1 px-2 text-white/70 hover:text-white"
                                  onClick={() => downloadExport(g.sessionId!, 'json')}
                                  title="Export JSON"
                                >
                                  <FileCode size={14} />
                                </button>
                              </>
                            )}
                            {(isRetake || isMissing) && (
                              <button
                                className="btn btn-primary text-xs py-1 px-2.5 font-bold flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black shadow-md"
                                onClick={() => handleRetake(g.gestureId, g.gestureName)}
                                disabled={retakeLoading === g.gestureId}
                                title="Ambil Ulang Data Gesture Ini"
                              >
                                {retakeLoading === g.gestureId ? (
                                  <RefreshCw size={12} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={12} />
                                )}
                                Retake
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Modal Dialog Diagnosa Lengkap */}
      {showDiagnosisModal && auditData && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowDiagnosisModal(false)}
        >
          <div 
            className="glass-card max-w-lg w-full p-6 space-y-4 border border-white/20 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${
                  auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL' ? (
                    <ShieldCheck size={26} />
                  ) : (
                    <AlertCircle size={26} />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">
                    Diagnosa Pola Data sEMG
                  </h3>
                  <p className="text-xs text-teal-300 font-semibold">
                    Partisipan: {auditData.participant.participantName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnosisModal(false)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
                title="Tutup"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <span className={`inline-block text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                auditData.summary.lossPattern.type === 'DISTRIBUTED_NORMAL'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {auditData.summary.lossPattern.type}
              </span>
              <h4 className="text-sm font-extrabold text-white">
                {auditData.summary.lossPattern.title}
              </h4>
              <p className="text-xs leading-relaxed text-white/90">
                {auditData.summary.lossPattern.description}
              </p>
            </div>

            {auditData.summary.lossPattern.problematicGestures?.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider block">
                  Daftar Gesture Yang Terindikasi Anomali:
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                  {auditData.summary.lossPattern.problematicGestures.map((pg) => (
                    <div 
                      key={pg.orderIndex}
                      className="p-2.5 rounded-lg bg-black/40 border border-white/10 flex items-center justify-between text-xs"
                    >
                      <span className="font-bold text-white">
                        #{pg.orderIndex} {pg.gestureName}
                      </span>
                      <span className="font-mono text-amber-300 font-bold">
                        Keaktifan: {pg.completenessPct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowDiagnosisModal(false)}
                className="btn btn-secondary text-xs px-5 py-2 font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
