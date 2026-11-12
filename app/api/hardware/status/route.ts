import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { toWibString } from '@/app/lib/export'

export const dynamic = 'force-dynamic'

const BRIDGE_HEALTH_URL = 'http://127.0.0.1:8000/health'

export async function GET() {
  let bridgeOnline = false
  let deviceConnected = false
  let isStreaming = false
  let lastSampleAgoSec: number | null = null
  let totalSamplesReceived = 0
  let port = 'COM3'
  let baudrate = 115200
  let activeSessionId: string | null = null
  let currentPhase: string | null = null
  let bufferSize = 0

  // 1. Ping Python Bridge (FastAPI port 8000)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)

    const res = await fetch(BRIDGE_HEALTH_URL, {
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.ok) {
      const data = await res.json()
      bridgeOnline = true

      // Format baru bridge menyediakan serialConnected dan isStreaming secara eksplisit
      if (typeof data.serialConnected === 'boolean') {
        deviceConnected = data.serialConnected
        isStreaming = typeof data.isStreaming === 'boolean' ? data.isStreaming : false
        lastSampleAgoSec = data.lastSampleAgoSec ?? null
        totalSamplesReceived = data.totalSamplesReceived ?? 0
        port = data.port ?? 'COM3'
        baudrate = data.baudrate ?? 115200
        activeSessionId = data.sessionId ?? null
        currentPhase = data.currentPhase ?? null
        bufferSize = data.bufferSize ?? 0
      } else {
        // Jika data.serialConnected undefined, berarti Python Bridge di terminal masih versi lama (belum di-restart)
        bridgeOnline = true
        deviceConnected = false
        isStreaming = false
        activeSessionId = data.sessionId ?? null
        currentPhase = data.currentPhase ?? null
        bufferSize = data.bufferSize ?? 0
      }
    }
  } catch {
    bridgeOnline = false
  }

  // 2. Query latest database record for metadata display only
  let lastDbRecordWib: string | null = null
  let lastDbSessionId: string | null = null
  try {
    const latest = await prisma.emgRecord.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, sessionId: true },
    })
    if (latest) {
      lastDbRecordWib = toWibString(latest.createdAt)
      lastDbSessionId = latest.sessionId
    }
  } catch {
    // ignore DB errors
  }

  // 3. Determine status & Indonesian message
  let status: 'ONLINE_STREAMING' | 'DEVICE_CONNECTED_IDLE' | 'DEVICE_DISCONNECTED' | 'BRIDGE_OFFLINE'
  let message: string

  if (!bridgeOnline) {
    status = 'BRIDGE_OFFLINE'
    message = 'Python Bridge (emg_bridge.py) belum aktif. Jalankan python emg_bridge.py di terminal.'
  } else if (isStreaming) {
    status = 'ONLINE_STREAMING'
    message = `Alat EMG aktif dan terhubung di ${port} (sinyal mengalir normal @${baudrate} baud).`
  } else if (deviceConnected) {
    status = 'DEVICE_CONNECTED_IDLE'
    message = `Alat EMG terhubung pada port ${port} (menunggu aliran data sinyal).`
  } else {
    status = 'DEVICE_DISCONNECTED'
    message = `Alat EMG mati atau sinyal terhenti pada port ${port}. Pastikan saklar daya alat ON dan kabel USB terpasang.`
  }

  return NextResponse.json({
    ok: status === 'ONLINE_STREAMING' || status === 'DEVICE_CONNECTED_IDLE',
    status,
    message,
    bridgeOnline,
    deviceConnected,
    isStreaming,
    lastSampleAgoSec,
    totalSamplesReceived,
    port,
    baudrate,
    activeSessionId,
    currentPhase,
    bufferSize,
    lastDbRecordWib,
    lastDbSessionId,
    checkedAtWib: toWibString(new Date()),
  })
}
