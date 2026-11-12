'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { PhaseType, SessionEvent } from '@/app/lib/types'
import { CheckCircle2 } from 'lucide-react'

interface SessionData {
  id: string
  status: 'pending' | 'running' | 'completed' | 'aborted'
  participantId?: string | null
  participantName: string | null
  gesture: {
    id: string
    name: string
    label: string
    videoUrl: string | null
  }
  config: {
    preparationDuration: number
    actionDuration: number
    restDuration: number
    repetitionCount: number
  }
  sequence?: {
    currentGestureIndex: number
    totalGestures: number
    completedGestures: number
    nextSessionId: string | null
  }
}

const PHASE_COLORS: Record<PhaseType, { bg: string; border: string; glow: string; text: string; label: string }> = {
  PREPARATION: {
    bg: 'rgba(6, 182, 212, 0.15)',
    border: 'rgba(6, 182, 212, 0.5)',
    glow: '0 0 40px rgba(6, 182, 212, 0.25), 0 0 80px rgba(6, 182, 212, 0.1)',
    text: '#06b6d4',
    label: 'PERSIAPAN',
  },
  ACTION: {
    bg: 'rgba(16, 185, 129, 0.25)', // Hijau gelap (opacity dinaikkan)
    border: 'rgba(16, 185, 129, 0.5)',
    glow: '0 0 40px rgba(16, 185, 129, 0.25), 0 0 80px rgba(16, 185, 129, 0.1)',
    text: '#10b981',
    label: 'AKSI — TAHAN POSE',
  },
  REST: {
    bg: 'rgba(245, 158, 11, 0.25)', // Orange kekuningan (opacity dinaikkan)
    border: 'rgba(245, 158, 11, 0.5)',
    glow: '0 0 40px rgba(245, 158, 11, 0.25), 0 0 80px rgba(245, 158, 11, 0.1)',
    text: '#f59e0b',
    label: 'ISTIRAHAT — RELAKSASI',
  },
}

// ── Python Bridge (local API, lihat emg_bridge.py) ───────────────────────────
const BRIDGE_BASE_URL = 'http://localhost:8000'
// Jangan kirim PUT /phase lebih sering dari ini KECUALI phase berubah (lihat
// reportPhaseToBridge) -- transition guard presisinya ditangani di bridge,
// throttle ini cuma mengurangi request HTTP redundan saat phase belum berubah.
const PHASE_REPORT_THROTTLE_MS = 100

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

export default function SessionRunner({ session }: { session: SessionData }) {
  const { config, gesture } = session

  // ── Core session state ─────────────────────────────────────────────────────
  const [phase, setPhase] = useState<PhaseType>('PREPARATION')
  const [repetition, setRepetition] = useState(1)
  const [isRunning, setIsRunning] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [finalAudit, setFinalAudit] = useState<{
    averageActionCompletenessPct: number
    lossPatternTitle: string
    lossPatternDescription: string
  } | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [hwStatus, setHwStatus] = useState<{
    online: boolean
    deviceConnected: boolean
    isStreaming: boolean
    message: string
  }>({ online: true, deviceConnected: true, isStreaming: true, message: '' })

  // Poll hardware/bridge status every 2 seconds
  useEffect(() => {
    let isMounted = true
    const checkHw = async () => {
      try {
        const res = await fetch('/api/hardware/status', { cache: 'no-store' })
        if (res.ok && isMounted) {
          const d = await res.json()
          setHwStatus({
            online: !!d.bridgeOnline,
            deviceConnected: !!d.deviceConnected,
            isStreaming: !!d.isStreaming,
            message: d.message || '',
          })
        }
      } catch {
        if (isMounted) {
          setHwStatus((prev) => ({ ...prev, online: false }))
        }
      }
    }

    checkHw()
    const timer = setInterval(checkHw, 2000)
    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [])

  // ── Countdown states ───────────────────────────────────────────────────────
  // Pre-start countdown (3,2,1 setelah admin klik Mulai)
  const [startCountdown, setStartCountdown] = useState<number | null>(null)
  // Phase transition countdown (3,2,1 sebelum ACTION)
  const [phaseCountdown, setPhaseCountdown] = useState<number | null>(null)
  // Whether we're blocked waiting for phase countdown to finish
  const phaseCountdownPendingRef = useRef(false)

  // ── Admin control & connectivity ───────────────────────────────────────────
  // 'waiting' = poll DB for status=running, 'aborted-remote' = aborted by admin
  const [screenState, setScreenState] = useState<'waiting' | 'countdown' | 'running' | 'aborted-remote' | 'finished'>('waiting')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const eventsRef = useRef<SessionEvent[]>([])
  const startTimeRef = useRef<number>(0)
  const phaseStartRef = useRef<number>(0)
  const rafRef = useRef<number>(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const relaxVideoRef = useRef<HTMLVideoElement>(null)
  const [relaxVideoError, setRelaxVideoError] = useState(false)
  const sessionStartedRef = useRef(false) // prevent double-start on re-render
  const repetitionRef = useRef(1) // mirror of repetition state, readable in callbacks without stale closure
  const lastReportedPhaseRef = useRef<PhaseType | null>(null)
  const lastPhaseReportTimeRef = useRef(0)

  // Direct DOM refs for timer & progress updates (avoids React re-render thrashing at 60fps)
  const timerBigRef = useRef<HTMLParagraphElement>(null)
  const timerSmallRef = useRef<HTMLSpanElement>(null)
  const phaseProgressBarRef = useRef<HTMLDivElement>(null)
  const timeRemainingRef = useRef<number>(config.preparationDuration)

  // Phase durations
  const getPhaseDuration = useCallback((p: PhaseType) => {
    switch (p) {
      case 'PREPARATION': return config.preparationDuration
      case 'ACTION': return config.actionDuration
      case 'REST': return config.restDuration
    }
  }, [config])

  // Log event
  const logEvent = useCallback((eventType: string, rep?: number, meta?: Record<string, unknown>) => {
    const event: SessionEvent = {
      eventType: eventType as SessionEvent['eventType'],
      repetitionNum: rep,
      clientTimestamp: Date.now(),
      metadata: {
        gestureName: gesture.name,
        gestureLabel: gesture.label,
        sessionId: session.id,
        ...meta,
      },
    }
    eventsRef.current.push(event)

    const GATEWAY_RELEVANT_EVENTS = ['PHASE_ACTION', 'SESSION_START', 'SESSION_END', 'SESSION_ABORT']
    if (GATEWAY_RELEVANT_EVENTS.includes(eventType)) {
      fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          sessionId: session.id,
          gestureName: gesture.name,
          repetitionNum: rep,
          clientTimestamp: event.clientTimestamp,
        }),
      }).catch(() => {})
    }
  }, [gesture, session.id])

  // Report active phase to Python Bridge local API (Web-Driven Labeling).
  // Fire-and-forget: kegagalan di sini TIDAK boleh menghentikan Master Clock
  // Next.js -- bridge yang belum jalan tidak boleh menggagalkan sesi.
  const reportPhaseToBridge = useCallback((currentPhase: PhaseType) => {
    const now = performance.now()
    const phaseChanged = currentPhase !== lastReportedPhaseRef.current
    const throttleElapsed = now - lastPhaseReportTimeRef.current >= PHASE_REPORT_THROTTLE_MS

    // Selalu kirim segera saat phase BERUBAH (supaya transition guard di
    // bridge dapat sinyal secepat mungkin); throttle hanya saat phase SAMA.
    if (!phaseChanged && !throttleElapsed) return

    lastReportedPhaseRef.current = currentPhase
    lastPhaseReportTimeRef.current = now

    fetch(`${BRIDGE_BASE_URL}/phase`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, phase: currentPhase }),
    }).catch(() => {
      // Diamkan -- bridge mungkin belum dijalankan operator, itu tidak
      // boleh menghentikan linimasa Web yang sedang berjalan.
    })
  }, [session.id])

  const notifyBridgeSessionStart = useCallback(() => {
    fetch(`${BRIDGE_BASE_URL}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    }).catch(() => {})
  }, [session.id])

  const notifyBridgeSessionEnd = useCallback(() => {
    fetch(`${BRIDGE_BASE_URL}/session/end`, { method: 'POST' }).catch(() => {})
  }, [])

  // Flush events to server
  const flushEvents = useCallback(async () => {
    if (eventsRef.current.length === 0) return
    const events = [...eventsRef.current]
    eventsRef.current = []
    try {
      await fetch(`/api/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      })
    } catch {
      eventsRef.current = [...events, ...eventsRef.current]
    }
  }, [session.id])

  // Transition to next phase (with PREP→ACTION countdown)
  const nextPhase = useCallback((currentPhase: PhaseType, currentRep: number) => {
    if (currentPhase === 'PREPARATION') {
      // Trigger phase transition countdown before ACTION
      phaseCountdownPendingRef.current = true
      setPhaseCountdown(3)
    } else if (currentPhase === 'ACTION') {
      setPhase('REST')
      timeRemainingRef.current = config.restDuration
      if (timerBigRef.current) timerBigRef.current.textContent = formatTime(config.restDuration)
      if (timerSmallRef.current) timerSmallRef.current.textContent = formatTime(config.restDuration)
      if (phaseProgressBarRef.current) phaseProgressBarRef.current.style.width = '0%'
      phaseStartRef.current = performance.now()
      logEvent('PHASE_REST', currentRep, { phaseDuration: config.restDuration })
      logEvent('REPETITION_END', currentRep)
    } else if (currentPhase === 'REST') {
      if (currentRep >= config.repetitionCount) {
        logEvent('SESSION_END', currentRep)
        notifyBridgeSessionEnd()
        setIsFinished(true)
        setIsRunning(false)
        setScreenState('finished')
        fetch(`/api/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        })
        flushEvents()
        return
      }
      const nextRep = currentRep + 1
      setRepetition(nextRep)
      repetitionRef.current = nextRep
      
      logEvent('REPETITION_START', nextRep)
      
      // Trigger phase transition countdown directly to ACTION
      phaseCountdownPendingRef.current = true
      setPhaseCountdown(3)
    }
  }, [config, logEvent, flushEvents, session.id, notifyBridgeSessionEnd])

  // ── Phase transition countdown (PREP → ACTION) ─────────────────────────────
  useEffect(() => {
    if (phaseCountdown === null) return

    if (phaseCountdown === 0) {
      // Countdown done — transition to ACTION
      setPhaseCountdown(null)
      phaseCountdownPendingRef.current = false

      // Transition happens here, after countdown
      setPhase('ACTION')
      timeRemainingRef.current = config.actionDuration
      if (timerBigRef.current) timerBigRef.current.textContent = formatTime(config.actionDuration)
      if (timerSmallRef.current) timerSmallRef.current.textContent = formatTime(config.actionDuration)
      if (phaseProgressBarRef.current) phaseProgressBarRef.current.style.width = '0%'
      phaseStartRef.current = performance.now()
      reportPhaseToBridge('ACTION')
      // Log with current repetition value via ref (safe from stale closure)
      logEvent('PHASE_ACTION', repetitionRef.current, { phaseDuration: config.actionDuration })

      // Play video when ACTION starts
      if (videoRef.current) {
        videoRef.current.currentTime = 0
        videoRef.current.play().catch(() => {})
      }
      return
    }

    const timer = setTimeout(() => setPhaseCountdown(c => (c !== null ? c - 1 : null)), 1000)
    return () => clearTimeout(timer)
  }, [phaseCountdown, config.actionDuration, logEvent, reportPhaseToBridge])

  // ── Main timer loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning || isFinished) return

    let lastPhase = phase
    let lastRep = repetition
    let lastFrameTime = performance.now()

    const tick = () => {
      const now = performance.now()
      const frameDelta = now - lastFrameTime
      lastFrameTime = now

      // Freeze during phase countdown (PREP -> ACTION transition)
      if (phaseCountdownPendingRef.current) {
        phaseStartRef.current += frameDelta
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const elapsed = (now - phaseStartRef.current) / 1000
      const duration = getPhaseDuration(lastPhase)
      const remaining = Math.max(0, duration - elapsed)

      timeRemainingRef.current = remaining

      // Direct DOM update: silky-smooth 60fps without React re-render thrashing
      const formatted = formatTime(remaining)
      if (timerBigRef.current) timerBigRef.current.textContent = formatted
      if (timerSmallRef.current) timerSmallRef.current.textContent = formatted
      if (phaseProgressBarRef.current && duration > 0) {
        const pct = Math.min(100, Math.max(0, ((duration - remaining) / duration) * 100))
        phaseProgressBarRef.current.style.width = `${pct}%`
      }

      reportPhaseToBridge(lastPhase)

      if (remaining <= 0) {
        nextPhase(lastPhase, lastRep)

        // Update local tracking
        if (lastPhase === 'PREPARATION') {
          // Will become ACTION after phase countdown — keep as PREPARATION until countdown done
          // The phaseCountdown useEffect will handle the actual state transition
          // So we do NOT update lastPhase to ACTION here yet
          // Instead mark as pending and let the RAF pause itself
          lastPhase = 'ACTION' // local only — so next tick we don't call nextPhase again
        } else if (lastPhase === 'ACTION') {
          lastPhase = 'REST'
        } else if (lastPhase === 'REST') {
          if (lastRep >= config.repetitionCount) return
          lastPhase = 'ACTION' // skip PREPARATION, go straight to ACTION
          lastRep += 1
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRunning, isFinished, phase, repetition, getPhaseDuration, nextPhase, config.repetitionCount, reportPhaseToBridge])

  // ── Periodic flush ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(flushEvents, 5000)
    return () => clearInterval(interval)
  }, [isRunning, flushEvents])

  // ── Poll session status from DB (admin control) ────────────────────────────
  // While waiting: detect when admin starts (status → running)
  // While running: detect when admin aborts (status → aborted)
  useEffect(() => {
    if (screenState === 'finished' || screenState === 'aborted-remote') return

    let cancelled = false

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}`, {
          headers: { 'Cache-Control': 'no-store' },
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { status: string }

        if (screenState === 'waiting' && data.status === 'running') {
          // Admin started the session — begin pre-start countdown
          if (!sessionStartedRef.current) {
            sessionStartedRef.current = true
            setScreenState('countdown')
            setStartCountdown(3)
          }
        } else if (screenState === 'running' && data.status === 'aborted') {
          // Admin aborted — stop session immediately
          cancelled = true
          cancelAnimationFrame(rafRef.current)
          setIsRunning(false)
          setScreenState('aborted-remote')
          notifyBridgeSessionEnd()
          flushEvents()
        }
      } catch { /* ignore */ }
    }

    pollStatus()
    const interval = setInterval(pollStatus, 1500)
    return () => { cancelled = true; clearInterval(interval) }
  }, [screenState, session.id, flushEvents, notifyBridgeSessionEnd])

  // ── Pre-start countdown (3,2,1 → GO!) ─────────────────────────────────────
  useEffect(() => {
    if (startCountdown === null) return
    if (startCountdown === 0) {
      setStartCountdown(null)
      setIsRunning(true)
      setScreenState('running')
      startTimeRef.current = performance.now()
      phaseStartRef.current = performance.now()
      timeRemainingRef.current = config.preparationDuration
      if (timerBigRef.current) timerBigRef.current.textContent = formatTime(config.preparationDuration)
      if (timerSmallRef.current) timerSmallRef.current.textContent = formatTime(config.preparationDuration)
      if (phaseProgressBarRef.current) phaseProgressBarRef.current.style.width = '0%'

      logEvent('SESSION_START', 1)
      logEvent('REPETITION_START', 1)
      logEvent('PHASE_PREPARATION', 1, { phaseDuration: config.preparationDuration })
      notifyBridgeSessionStart()
      reportPhaseToBridge('PREPARATION')

      // Video starts during PREPARATION, not ACTION
      // Autoplay on first PREP
      if (videoRef.current) {
        videoRef.current.currentTime = 0
        videoRef.current.play().catch(() => {})
      }
      return
    }
    const timer = setTimeout(() => setStartCountdown(c => (c !== null ? c - 1 : null)), 1000)
    return () => clearTimeout(timer)
  }, [startCountdown, config.preparationDuration, logEvent, notifyBridgeSessionStart, reportPhaseToBridge])

  // ── Auto-play video after remounts ────────────────────────────────────────
  useEffect(() => {
    if (screenState === 'running' && phaseCountdown === null && phase !== 'REST') {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {})
      }
    }
  }, [screenState, phaseCountdown, phase, repetition])

  useEffect(() => {
    if (screenState === 'running' && phase === 'REST') {
      if (relaxVideoRef.current && !relaxVideoError) {
        relaxVideoRef.current.currentTime = 0
        relaxVideoRef.current.play().catch(() => {})
      }
    }
  }, [screenState, phase, relaxVideoError])

  // ── Fetch Final Audit when session or sequence completes ─────────────────
  useEffect(() => {
    if (screenState === 'finished' && !session.sequence?.nextSessionId) {
      setAuditLoading(true)
      const target = session.participantId || session.id
      fetch(`/api/audit/${encodeURIComponent(target)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            const isSingle = (session.sequence?.totalGestures || 1) === 1
            const thisGesture = Array.isArray(data.gestures)
              ? data.gestures.find((g: any) => g.gestureId === gesture.id || g.gestureName === gesture.name)
              : null

            if (isSingle && thisGesture) {
              setFinalAudit({
                averageActionCompletenessPct: thisGesture.completenessPct,
                lossPatternTitle: `Audit Gesture: ${gesture.label}`,
                lossPatternDescription:
                  thisGesture.completenessPct >= 75
                    ? `Data fase ACTION terekam dengan baik (${thisGesture.completenessPct}%, ${thisGesture.ratingLabel}). Sinyal stabil untuk analisis.`
                    : `Data fase ACTION tercatat ${thisGesture.completenessPct}% (${thisGesture.ratingLabel}). ${thisGesture.recommendation}`,
              })
            } else if (data.summary) {
              setFinalAudit({
                averageActionCompletenessPct: data.summary.averageActionCompletenessPct,
                lossPatternTitle: data.summary.lossPattern.title,
                lossPatternDescription: data.summary.lossPattern.description,
              })
            }
          }
        })
        .catch(() => {})
        .finally(() => setAuditLoading(false))
    }
  }, [screenState, session.sequence?.nextSessionId, session.sequence?.totalGestures, session.participantId, session.id, gesture.id, gesture.name, gesture.label])

  // ── Render helpers ─────────────────────────────────────────────────────────
  const phaseDuration = getPhaseDuration(phase)
  const initialPhaseProgress = phaseDuration > 0 ? ((phaseDuration - timeRemainingRef.current) / phaseDuration) * 100 : 0
  const totalPhases = 1 + (config.repetitionCount * 2)
  const completedPhases = repetition === 1 
    ? (phase === 'PREPARATION' ? 0 : phase === 'ACTION' ? 1 : 2)
    : 1 + ((repetition - 1) * 2) + (phase === 'ACTION' ? 0 : 1)
  const totalProgress = (completedPhases / totalPhases) * 100
  const phaseStyle = PHASE_COLORS[phase]

  // ── SCREEN: Waiting for admin ──────────────────────────────────────────────
  if (screenState === 'waiting') {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center glass-card p-10 max-w-lg w-full animate-fade-in border border-white/20 shadow-2xl">
          {/* Animated pulse ring */}
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div
              className="absolute inset-0 rounded-full animate-ping opacity-30"
              style={{ background: 'var(--color-accent)' }}
            />
            <div
              className="relative w-24 h-24 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-preparation))' }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
          </div>

          <h1 className="text-3xl font-extrabold mb-1 text-white">
            Layar Partisipan
          </h1>
          <p className="text-xl font-bold mb-3 text-teal-300">
            {gesture.label}
          </p>

          {session.sequence && (
            <div className="inline-block px-4 py-1 rounded-full bg-teal-500/20 border border-teal-400/40 text-sm font-bold text-white mb-4">
              🎯 Gesture {session.sequence.currentGestureIndex} dari {session.sequence.totalGestures}
            </div>
          )}

          {(session.participantName || session.participantId) && (
            <div className="bg-white/10 rounded-xl px-5 py-3 mb-6 border border-white/15">
              <span className="text-xs uppercase tracking-wider font-bold text-white/80 block mb-0.5">Partisipan</span>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-lg font-extrabold text-white">{session.participantName || 'Tanpa Nama'}</span>
                {session.participantId && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30">
                    ID: {session.participantId}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Warning if hardware not detected before starting */}
          {(!hwStatus.deviceConnected || !hwStatus.online) && (
            <div className="p-4 rounded-xl bg-rose-500/20 border-2 border-rose-500/60 text-left mb-5 animate-pulse">
              <div className="flex items-center gap-2 text-rose-300 font-black text-sm uppercase">
                <span>⚠️</span>
                <span>Alat EMG Belum Terdeteksi</span>
              </div>
              <p className="text-xs text-white/90 mt-1 font-medium leading-relaxed">
                {hwStatus.online
                  ? 'Alat sEMG dalam keadaan mati atau kabel USB belum terhubung. Nyalakan alat sebelum admin memulai sesi agar data terekam!'
                  : 'Python bridge (emg_bridge.py) belum aktif. Jalankan python emg_bridge.py di terminal.'}
              </p>
            </div>
          )}

          <div
            className="rounded-xl px-6 py-4 mb-6"
            style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.4)' }}
          >
            <p className="text-base font-bold text-cyan-300">
              ⏳ Menunggu admin memulai sesi...
            </p>
            <p className="text-xs mt-1 font-semibold text-white/90">
              Jangan tutup halaman ini. Sesi akan otomatis dimulai saat admin menekan tombol Mulai.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Persiapan', value: `${config.preparationDuration}s`, color: 'var(--color-preparation)' },
              { label: 'Aksi', value: `${config.actionDuration}s`, color: 'var(--color-action)' },
              { label: 'Istirahat', value: `${config.restDuration}s`, color: 'var(--color-rest)' },
              { label: 'Repetisi', value: `${config.repetitionCount}×`, color: 'var(--color-accent)' },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-xl border border-white/10" style={{ background: 'rgba(0,0,0,0.4)' }}>
                <p className="text-xs font-bold text-white/80">{item.label}</p>
                <p className="text-lg font-black" style={{ color: item.color }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── SCREEN: Aborted by admin ───────────────────────────────────────────────
  if (screenState === 'aborted-remote') {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center glass-card p-10 max-w-md w-full animate-slide-up border border-red-500/30">
          <div className="text-6xl mb-4">🛑</div>
          <h1 className="text-2xl font-extrabold mb-2 text-red-400">
            Sesi Dihentikan
          </h1>
          <p className="text-sm font-semibold mb-6 text-white">
            Admin telah menghentikan sesi ini. Tunggu instruksi selanjutnya.
          </p>
          <p className="text-xs font-mono font-bold text-white/80">
            Sesi: {session.id}
          </p>
        </div>
      </div>
    )
  }

  // ── SCREEN: Finished ───────────────────────────────────────────────────────
  if (screenState === 'finished') {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center glass-card p-10 max-w-lg w-full animate-slide-up border-2 border-emerald-500/40 shadow-2xl">
          <div className="text-6xl mb-3">✅</div>
          <h1 className="text-3xl font-black mb-4 text-white">
            Sesi Selesai!
          </h1>

          <div className="bg-white/5 rounded-2xl p-5 mb-6 text-left space-y-3.5 border border-white/15">
            <div className="flex justify-between items-center pb-2.5 border-b border-white/10">
              <span className="text-xs font-bold uppercase tracking-wider text-white/80">Partisipan</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold text-white">{session.participantName || '-'}</span>
                {session.participantId && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                    ID: {session.participantId}
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center pb-2.5 border-b border-white/10">
              <span className="text-xs font-bold uppercase tracking-wider text-white/80">ID Sesi</span>
              <span className="font-mono text-sm font-bold text-teal-300">{session.id}</span>
            </div>

            <div className="flex justify-between items-center pb-2.5 border-b border-white/10">
              <span className="text-xs font-bold uppercase tracking-wider text-white/80">Gesture Selesai</span>
              <span className="text-base font-extrabold text-white">{gesture.label}</span>
            </div>

            <div className="flex justify-between items-center pb-2.5 border-b border-white/10">
              <span className="text-xs font-bold uppercase tracking-wider text-white/80">Jumlah Repetisi</span>
              <span className="text-base font-bold text-white">{config.repetitionCount} Repetisi</span>
            </div>

            {session.sequence && (
              <div className="pt-1 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  {session.sequence.totalGestures === 1 ? 'Cakupan Sesi' : 'Progres Gesture Lengkap'}
                </span>
                <span className="text-base font-black text-white">
                  {session.sequence.totalGestures === 1
                    ? `1 Gesture (${gesture.label})`
                    : `${session.sequence.currentGestureIndex} dari ${session.sequence.totalGestures} Gesture`}
                </span>
              </div>
            )}
          </div>

          {session.sequence?.nextSessionId ? (
            <button
              onClick={() => {
                window.location.href = `/session/${session.sequence!.nextSessionId}`
              }}
              className="btn btn-primary w-full py-4 text-base font-extrabold flex items-center justify-center gap-2 shadow-xl hover:scale-105 transition-all text-white"
            >
              Lanjut ke Gesture Berikutnya →
            </button>
          ) : (
            <div className="rounded-2xl p-5 bg-gradient-to-b from-emerald-500/20 to-black/50 border-2 border-emerald-500/40 text-left space-y-3 shadow-2xl">
              <div className="flex items-center gap-2 text-emerald-400 font-black text-sm uppercase tracking-wider">
                <CheckCircle2 size={20} />
                {session.sequence && session.sequence.totalGestures > 1
                  ? `RANGKAIAN ${session.sequence.totalGestures} GESTURE SELESAI`
                  : 'SESI 1 GESTURE SELESAI'}
              </div>
              <p className="text-xs text-white/90 font-medium">
                {session.sequence && session.sequence.totalGestures > 1
                  ? 'Terima kasih telah menyelesaikan seluruh rangkaian pengambilan data sEMG.'
                  : `Pengambilan data untuk gesture ${gesture.label} telah selesai direkam.`}
              </p>

              {auditLoading && (
                <div className="flex items-center gap-2 text-xs text-teal-300 py-1.5 font-bold">
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-teal-300 border-t-transparent rounded-full" />
                  Menganalisis kontinuitas sinyal fase ACTION (@200Hz)...
                </div>
              )}

              {finalAudit && (
                <div className="pt-2 border-t border-white/15 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-extrabold text-white/80 uppercase">
                      {session.sequence?.totalGestures === 1
                        ? 'Keaktifan Sinyal ACTION'
                        : 'Rata-Rata Keaktifan ACTION'}
                    </span>
                    <span className="text-xl font-black text-teal-300 font-mono">
                      {finalAudit.averageActionCompletenessPct}%
                    </span>
                  </div>
                  <div className="text-xs text-white/90 bg-white/10 p-3 rounded-xl border border-white/15">
                    <strong className="text-white block mb-0.5 font-extrabold">{finalAudit.lossPatternTitle}</strong>
                    <span className="text-white/80">{finalAudit.lossPatternDescription}</span>
                  </div>
                </div>
              )}

              <a
                href={`/admin/status?id=${encodeURIComponent(session.participantId || session.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary w-full py-3 text-xs font-extrabold flex items-center justify-center gap-1.5 text-teal-300 border border-teal-500/30 hover:border-teal-400 mt-2"
              >
                Lihat Detail Lengkap di Dashboard Audit ➔
              </a>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: Main session runner UI ─────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 flex flex-col transition-all duration-500"
      style={{
        background: phaseStyle.bg,
        borderTop: `4px solid ${phaseStyle.border}`,
      }}
    >
      {/* Top Bar: Progress (n/12 or single) & Large Volunteer/Session Info */}
      <div className="px-6 py-3 flex items-center justify-between z-20 border-b border-white/10 bg-black/40 backdrop-blur-md">
        {/* Left: Overall gesture progress */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-xl bg-teal-500/20 border border-teal-400/50 shadow-md flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-teal-300">Gesture</span>
            <span className="text-base font-black text-white">
              {session.sequence && session.sequence.totalGestures > 1 ? (
                <>
                  {session.sequence.currentGestureIndex}
                  <span className="text-white/80 font-bold text-xs ml-1">
                    / {session.sequence.totalGestures}
                  </span>
                </>
              ) : (
                <>
                  1
                  <span className="text-white/80 font-bold text-xs ml-1">
                    / 1 (Tunggal)
                  </span>
                </>
              )}
            </span>
          </div>

          {/* Participant Name & ID (top left of screen) */}
          {(session.participantName || session.participantId) && (
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white/10 border border-white/15">
              <span className="text-xs font-bold uppercase tracking-wider text-white/80">Partisipan:</span>
              <span className="text-base font-extrabold text-white">{session.participantName || 'Tanpa Nama'}</span>
              {session.participantId && (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  ID: {session.participantId}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Hardware Status Indicator & Sesi ID */}
        <div className="flex items-center gap-2.5">
          {/* Live Hardware Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-md ${
              hwStatus.isStreaming
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                : hwStatus.deviceConnected
                ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                : 'bg-rose-500/25 border-rose-400/60 text-rose-200 ring-2 ring-rose-500/50 animate-pulse'
            }`}
            title={hwStatus.message}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                hwStatus.isStreaming
                  ? 'bg-emerald-400 animate-ping'
                  : hwStatus.deviceConnected
                  ? 'bg-cyan-400'
                  : 'bg-rose-400 animate-bounce'
              }`}
            />
            <span>
              {hwStatus.isStreaming
                ? 'Alat Merekam'
                : hwStatus.deviceConnected
                ? 'Alat Terhubung'
                : hwStatus.online
                ? 'Alat Terputus!'
                : 'Bridge Offline'}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/10 border border-white/15">
            <span className="text-xs font-bold uppercase tracking-wider text-white/80">Sesi:</span>
            <span className="font-mono text-sm font-black text-teal-300">{session.id.slice(-8)}</span>
          </div>
        </div>
      </div>

      {/* Disconnect Alert Banner while running */}
      {(!hwStatus.deviceConnected || !hwStatus.online) && (
        <div className="mx-6 my-2 p-3 rounded-xl bg-rose-600/90 border-2 border-rose-300 text-white flex items-center justify-between shadow-2xl z-30 animate-pulse">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <strong className="block text-sm font-black uppercase tracking-wider text-white">
                PERINGATAN: ALAT EMG MATI / TIDAK TERDETEKSI!
              </strong>
              <span className="text-xs text-rose-100 font-semibold">
                {hwStatus.online
                  ? 'Alat sEMG terputus dari USB atau baterai/daya mati. Segera periksa koneksi alat agar data terekam!'
                  : 'Python bridge (emg_bridge.py) belum aktif. Data sensor tidak akan tersimpan ke database.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Phase Banner */}
      <div
        className="text-center py-3.5 transition-all duration-500"
        style={{ background: phaseStyle.border, boxShadow: phaseStyle.glow }}
      >
        <h2 className="text-xl font-black tracking-widest uppercase text-white drop-shadow-md">
          {phaseStyle.label}
        </h2>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Dual Video Player (Gesture Action vs Relaxation) */}
        <div
          className="w-full max-w-3xl rounded-2xl overflow-hidden transition-all duration-500 relative"
          style={{
            border: `2px solid ${phaseStyle.border}`,
            boxShadow: phaseStyle.glow,
            aspectRatio: '16/9',
            background: '#000',
          }}
        >
          {/* Layer 1: Gesture Action Video (shown when NOT in REST) */}
          <div
            className="absolute inset-0 transition-opacity duration-300"
            style={{
              opacity: phase === 'REST' ? 0 : 1,
              pointerEvents: phase === 'REST' ? 'none' : 'auto',
            }}
          >
            {gesture.videoUrl ? (
              <video
                key={gesture.id}
                ref={videoRef}
                src={gesture.videoUrl}
                className="w-full h-full object-contain"
                loop
                muted
                playsInline
                preload="auto"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <span className="text-6xl mb-3">🤚</span>
                <p className="text-lg font-bold text-white">{gesture.label}</p>
              </div>
            )}
          </div>

          {/* Layer 2: Relaxation Video / Fallback (shown when in REST) */}
          <div
            className="absolute inset-0 transition-opacity duration-300 flex flex-col items-center justify-center"
            style={{
              opacity: phase === 'REST' ? 1 : 0,
              pointerEvents: phase === 'REST' ? 'auto' : 'none',
              background: '#0a0a0a',
            }}
          >
            {!relaxVideoError ? (
              <video
                ref={relaxVideoRef}
                src="/videos/hand_relax.mp4"
                className="w-full h-full object-contain"
                loop
                muted
                playsInline
                preload="auto"
                onError={() => setRelaxVideoError(true)}
              />
            ) : null}

            {/* Fallback visual if video is not yet placed or failed to load */}
            {relaxVideoError && (
              <div className="flex flex-col items-center justify-center text-center p-6 animate-fade-in">
                <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-500/60 flex items-center justify-center mb-4 text-5xl animate-pulse">
                  🖐️
                </div>
                <h3 className="text-2xl font-black text-white mb-2">Fase Relaksasi & Istirahat</h3>
                <p className="text-base font-bold text-amber-300 max-w-md">
                  Lepaskan seluruh ketegangan otot tangan. Biarkan tangan dan jari rileks sepenuhnya.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Info Row */}
        <div className="flex items-center justify-between w-full max-w-3xl mt-6">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider font-extrabold text-white/90">Repetisi</p>
              <p className="text-3xl font-black text-white">
                {repetition} <span className="text-white/70 font-bold text-lg">/ {config.repetitionCount}</span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-extrabold text-white/90">Gesture</p>
              <p className="text-xl font-black text-white">{gesture.label}</p>
            </div>
          </div>

          {/* Timer */}
          <div className="text-right">
            <p
              ref={timerBigRef}
              className="text-5xl font-mono font-black tracking-tight text-white drop-shadow-md"
            >
              {formatTime(timeRemainingRef.current)}
            </p>
          </div>
        </div>

        {/* Progress Bars */}
        <div className="w-full max-w-3xl mt-6 space-y-3.5">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-extrabold text-white uppercase tracking-wider">Sisa Waktu Fase</span>
              <span ref={timerSmallRef} className="font-extrabold text-white">
                {formatTime(timeRemainingRef.current)}
              </span>
            </div>
            <div className="progress-bar h-3 bg-black/50 border border-white/15">
              <div
                ref={phaseProgressBarRef}
                className="progress-bar-fill"
                style={{
                  width: `${initialPhaseProgress}%`,
                  background: `linear-gradient(90deg, ${phaseStyle.text}, ${phaseStyle.border})`,
                }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-extrabold text-white uppercase tracking-wider">Progres Repetisi Sesi Ini</span>
              <span className="font-black text-teal-300 text-sm">{Math.round(totalProgress)}%</span>
            </div>
            <div className="progress-bar h-3 bg-black/50 border border-white/15">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${totalProgress}%`,
                  background: 'linear-gradient(90deg, var(--color-accent), var(--color-preparation))',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="px-6 py-3.5 flex items-center justify-between border-t border-white/10 bg-black/30">
        <div className="text-sm font-bold text-white flex items-center gap-3">
          {session.participantName && <span>Partisipan: <strong className="text-teal-300">{session.participantName}</strong></span>}
          <span>·</span>
          <span>Sesi: <strong className="font-mono text-white">{session.id}</strong></span>
        </div>
        <div className="text-xs font-bold text-white/80">
          Dikontrol oleh admin
        </div>
      </div>

      {/* Overlay: Pre-start countdown (3,2,1) */}
      {screenState === 'countdown' && startCountdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: 'var(--bg-primary)' }}>
          <div className="text-center">
            <p className="text-base uppercase tracking-widest mb-4 font-black text-white">
              Bersiap...
            </p>
            <div
              className="text-9xl font-black animate-countdown text-teal-300"
              key={startCountdown}
              style={{ textShadow: '0 0 60px rgba(20,184,166,0.6)' }}
            >
              {startCountdown}
            </div>
            <p className="mt-6 text-2xl font-extrabold text-white">
              {gesture.label}
            </p>
          </div>
        </div>
      )}

      {/* Overlay: Phase transition countdown (PREP → ACTION) */}
      {phaseCountdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: 'var(--bg-primary)' }}>
          <div className="text-center">
            <p
              className="text-base uppercase tracking-widest mb-4 font-black text-emerald-400"
            >
              Fase Aksi Dimulai!
            </p>
            <div
              className="text-9xl font-black animate-countdown text-emerald-400"
              key={`phase-${phaseCountdown}`}
              style={{ textShadow: '0 0 60px rgba(16,185,129,0.7)' }}
            >
              {phaseCountdown}
            </div>
            <p className="mt-6 text-2xl font-extrabold text-white">
              Tahan Pose — {gesture.label}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
