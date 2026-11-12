'use client'

import { useState, useEffect } from 'react'
import { Cpu, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity, Radio, Clock } from 'lucide-react'

interface HardwareStatus {
  ok: boolean
  status: 'ONLINE_STREAMING' | 'DEVICE_CONNECTED_IDLE' | 'DEVICE_DISCONNECTED' | 'BRIDGE_OFFLINE'
  message: string
  bridgeOnline: boolean
  deviceConnected: boolean
  isStreaming: boolean
  lastSampleAgoSec: number | null
  totalSamplesReceived: number
  port: string
  baudrate: number
  activeSessionId: string | null
  currentPhase: string | null
  bufferSize: number
  lastDbRecordWib: string | null
  checkedAtWib: string
}

export default function HardwareStatusCard() {
  const [status, setStatus] = useState<HardwareStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const checkStatus = async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await fetch('/api/hardware/status', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }

  useEffect(() => {
    checkStatus()
    const timer = setInterval(() => {
      checkStatus()
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  const isStreaming = status?.isStreaming
  const isDeviceConnected = status?.deviceConnected
  const isBridgeOnline = status?.bridgeOnline

  return (
    <div
      className={`glass-card p-5 border transition-all duration-300 relative overflow-hidden ${
        isStreaming
          ? 'border-emerald-500/40 bg-emerald-500/5 shadow-emerald-500/10'
          : isDeviceConnected
          ? 'border-cyan-500/40 bg-cyan-500/5'
          : isBridgeOnline
          ? 'border-amber-500/50 bg-amber-500/5 shadow-amber-500/10'
          : 'border-rose-500/40 bg-rose-500/5'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Device Icon & Title */}
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 shadow-lg ${
              isStreaming
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : isDeviceConnected
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : isBridgeOnline
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 animate-pulse'
                : 'bg-rose-500/20 border-rose-400 text-rose-300'
            }`}
          >
            <Cpu size={24} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                Status Alat EMG & Bridge Hardware
              </h2>
              {/* Badge Status */}
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border ${
                  isStreaming
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 ring-1 ring-emerald-400/30'
                    : isDeviceConnected
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : isBridgeOnline
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 ring-1 ring-amber-400/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isStreaming
                      ? 'bg-emerald-400 animate-ping'
                      : isDeviceConnected
                      ? 'bg-cyan-400'
                      : isBridgeOnline
                      ? 'bg-amber-400 animate-bounce'
                      : 'bg-rose-400'
                  }`}
                />
                {loading
                  ? 'Memeriksa...'
                  : isStreaming
                  ? 'ALAT AKTIF & MENGALIR'
                  : isDeviceConnected
                  ? 'PORT TERHUBUNG (STANDBY)'
                  : isBridgeOnline
                  ? 'ALAT MATI / TIDAK TERDETEKSI'
                  : 'BRIDGE OFFLINE'}
              </span>
            </div>

            <p className="text-xs text-white/80 mt-1 font-medium max-w-2xl leading-relaxed">
              {loading
                ? 'Menghubungi Python Bridge dan port serial...'
                : status?.message}
            </p>
          </div>
        </div>

        {/* Right: Actions & Live Indicators */}
        <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => checkStatus(true)}
            disabled={refreshing}
            className="btn btn-ghost text-xs px-3 py-1.5 border border-white/15 hover:border-white/30 text-white/80 hover:text-white flex items-center gap-1.5"
            title="Periksa ulang koneksi hardware"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin text-teal-400' : ''} />
            <span>Cek Ulang</span>
          </button>
        </div>
      </div>

      {/* Detail Metrics Strip */}
      {status && (
        <div className="mt-4 pt-3.5 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
            <span className="text-[10px] uppercase font-bold text-white/50 block">Port Serial</span>
            <span className="font-mono font-bold text-white mt-0.5 block">
              {status.port} @ {status.baudrate} baud
            </span>
          </div>

          <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
            <span className="text-[10px] uppercase font-bold text-white/50 block">Sinyal Masuk</span>
            <span className="font-mono font-bold mt-0.5 block text-teal-300">
              {status.isStreaming ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Radio size={12} className="animate-pulse" /> Mengalir Aktif
                </span>
              ) : status.lastSampleAgoSec !== null ? (
                `${status.lastSampleAgoSec}s lalu`
              ) : (
                <span className="text-amber-300">Belum ada sinyal</span>
              )}
            </span>
          </div>

          <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
            <span className="text-[10px] uppercase font-bold text-white/50 block">Python Bridge</span>
            <span className="font-mono font-bold mt-0.5 block">
              {status.bridgeOnline ? (
                <span className="text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Running (:8000)
                </span>
              ) : (
                <span className="text-rose-400 flex items-center gap-1">
                  <XCircle size={12} /> Mati
                </span>
              )}
            </span>
          </div>

          <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
            <span className="text-[10px] uppercase font-bold text-white/50 block">Rekam DB Terakhir</span>
            <span className="font-mono font-medium text-white/70 mt-0.5 block truncate" title={status.lastDbRecordWib || 'Belum ada'}>
              {status.lastDbRecordWib ? status.lastDbRecordWib.slice(11) + ' WIB' : '-'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
