import type { ExportData } from './types'

export function toWibString(date: Date | string | null | undefined): string {
  if (!date) return ''
  const dObj = typeof date === 'string' ? new Date(date) : date
  if (isNaN(dObj.getTime())) return ''
  const wib = new Date(dObj.getTime() + 7 * 3600 * 1000)
  const y = wib.getUTCFullYear()
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0')
  const day = String(wib.getUTCDate()).padStart(2, '0')
  const h = String(wib.getUTCHours()).padStart(2, '0')
  const min = String(wib.getUTCMinutes()).padStart(2, '0')
  const s = String(wib.getUTCSeconds()).padStart(2, '0')
  const ms = String(wib.getUTCMilliseconds()).padStart(3, '0')
  return `${y}-${m}-${day} ${h}:${min}:${s}.${ms}`
}

export function formatGender(gender: string | null | undefined): string {
  if (!gender) return '-'
  const g = gender.trim().toLowerCase()
  if (g === 'male' || g === 'laki-laki' || g === 'pria') return 'Laki-laki'
  if (g === 'female' || g === 'perempuan' || g === 'wanita') return 'Perempuan'
  return gender
}

export function formatDominantHand(hand: string | null | undefined): string {
  if (!hand) return '-'
  const h = hand.trim().toLowerCase()
  if (h === 'right' || h === 'kanan') return 'Kanan'
  if (h === 'left' || h === 'kiri') return 'Kiri'
  if (h === 'ambidextrous' || h === 'keduanya') return 'Keduanya (Ambidextrous)'
  return hand
}

export function exportToCSV(data: ExportData): string {
  if (data.emgRecords && data.emgRecords.length > 0) {
    const headers = [
      'sample_index',
      'elapsed_ms',
      'phase',
      'is_transition',
      'gesture',
      'raw_ch1',
      'raw_ch2',
      'raw_ch3',
      'raw_ch4',
      'raw_ch5',
      'raw_ch6',
      'proc_ch1',
      'proc_ch2',
      'proc_ch3',
      'proc_ch4',
      'proc_ch5',
      'proc_ch6',
      'participant_name',
      'participant_id',
      'session_id',
      'waktu_sesi',
      'timestamp_wib',
      'timestamp_utc',
    ]

    const rows = data.emgRecords.map((r) => [
      r.sampleIndex,
      r.elapsedMs,
      r.phase,
      r.isTransition ? 1 : 0,
      `"${r.gesture || data.gestureName}"`,
      r.r1,
      r.r2,
      r.r3,
      r.r4,
      r.r5,
      r.r6,
      r.p1,
      r.p2,
      r.p3,
      r.p4,
      r.p5,
      r.p6,
      `"${data.participantName}"`,
      `"${data.participantId ?? ''}"`,
      `"${data.sessionId}"`,
      `"${data.sessionTime || 'PAGI'}"`,
      `"${toWibString(r.timestamp)}"`,
      `"${r.timestamp}"`,
    ].join(','))

    return [headers.join(','), ...rows].join('\n')
  }

  // Fallback to events log if no EMG records
  const headers = [
    'session_id',
    'participant_id',
    'participant_name',
    'age',
    'gender',
    'dominant_hand',
    'condition',
    'gesture_name',
    'gesture_label',
    'event_type',
    'repetition_num',
    'server_timestamp_wib',
    'server_timestamp_utc',
    'client_timestamp_ms',
  ]

  const rows = data.events.map((event) => [
    data.sessionId,
    data.participantId ?? '',
    data.participantName,
    data.age ?? '',
    data.gender ?? '',
    data.dominantHand ?? '',
    data.condition ?? '',
    data.gestureName,
    data.gestureLabel,
    event.eventType,
    event.repetitionNum ?? '',
    toWibString(event.timestamp),
    event.timestamp,
    event.clientTimestamp,
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n')

  return csvContent
}

export function exportToJSON(data: ExportData): string {
  return JSON.stringify(data, null, 2)
}
