'use client'

import { useState } from 'react'
import { createConfig, updateConfig, setActiveConfig } from '@/app/lib/actions'
import { Hourglass, Dumbbell, Coffee, RotateCw } from 'lucide-react'

interface Config {
  id: string
  name: string
  preparationDuration: number
  actionDuration: number
  restDuration: number
  repetitionCount: number
  morningCutoffHour?: number
  minRestIntervalHours?: number
  isActive: boolean
}

export default function ConfigManager({ configs: initialConfigs }: { configs: Config[] }) {
  const [configs, setConfigs] = useState(initialConfigs)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Config | null>(null)

  async function refreshConfigs() {
    const res = await fetch('/api/config')
    setConfigs(await res.json())
  }

  async function handleSubmit(formData: FormData) {
    if (editing) {
      await updateConfig(editing.id, formData)
    } else {
      await createConfig(formData)
    }
    await refreshConfigs()
    setShowForm(false)
    setEditing(null)
  }

  async function handleSetActive(id: string) {
    await setActiveConfig(id)
    await refreshConfigs()
  }

  const activeConfig = configs.find(c => c.isActive)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Konfigurasi Timer & Jadwal</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Atur durasi fase, jumlah repetisi, batas jam pagi/sore, dan jeda istirahat antar-sesi
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditing(null) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Buat Konfigurasi
        </button>
      </div>

      {/* Active Config Highlight */}
      {activeConfig && (
        <div className="glass-card p-6 glow-action space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full animate-pulse-glow" style={{ background: 'var(--color-action)' }} />
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-action)' }}>
                Konfigurasi Aktif: {activeConfig.name}
              </h2>
            </div>
            <button
              onClick={() => { setEditing(activeConfig); setShowForm(true) }}
              className="text-xs font-bold text-teal-300 hover:underline"
            >
              Ubah Parameter ➔
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <PhaseCard label="Persiapan" value={activeConfig.preparationDuration} unit="detik" color="var(--color-preparation)" icon={<Hourglass strokeWidth={1.5} className="w-6 h-6 opacity-70" />} />
            <PhaseCard label="Aksi" value={activeConfig.actionDuration} unit="detik" color="var(--color-action)" icon={<Dumbbell strokeWidth={1.5} className="w-6 h-6 opacity-70" />} />
            <PhaseCard label="Istirahat" value={activeConfig.restDuration} unit="detik" color="var(--color-rest)" icon={<Coffee strokeWidth={1.5} className="w-6 h-6 opacity-70" />} />
            <PhaseCard label="Repetisi" value={activeConfig.repetitionCount} unit="kali" color="var(--color-accent)" icon={<RotateCw strokeWidth={1.5} className="w-6 h-6 opacity-70" />} />
          </div>

          {/* Schedule & Rest interval info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/10 text-xs">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
              <span className="text-white/70 font-semibold">Batas Jam Sesi Pagi vs Sore:</span>
              <span className="font-extrabold text-teal-300">
                Pagi &lt; {activeConfig.morningCutoffHour ?? 12}:00 WIB | Sore &ge; {activeConfig.morningCutoffHour ?? 12}:00 WIB
              </span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
              <span className="text-white/70 font-semibold">Jeda Minimal Istirahat Otot:</span>
              <span className="font-extrabold text-amber-300">
                {activeConfig.minRestIntervalHours ?? 4.0} Jam
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl text-xs" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
            Total durasi per gesture: <strong style={{ color: 'var(--text-primary)' }}>
              {((activeConfig.preparationDuration + activeConfig.actionDuration + activeConfig.restDuration) * activeConfig.repetitionCount)} detik
            </strong> ({((activeConfig.preparationDuration + activeConfig.actionDuration + activeConfig.restDuration) * activeConfig.repetitionCount / 60).toFixed(1)} menit)
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="glass-card p-6 w-full max-w-md animate-slide-up" style={{ background: 'var(--bg-surface)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              {editing ? 'Edit Konfigurasi' : 'Buat Konfigurasi Baru'}
            </h2>
            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Nama Konfigurasi</label>
                <input name="name" className="input" required defaultValue={editing?.name || ''} placeholder="e.g. Quick Test" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-2"><Hourglass className="w-4 h-4 text-cyan-400" /> Persiapan (detik)</label>
                  <input name="preparationDuration" type="number" min="1" max="30" className="input" required defaultValue={editing?.preparationDuration ?? 3} />
                </div>
                <div>
                  <label className="label flex items-center gap-2"><Dumbbell className="w-4 h-4 text-emerald-400" /> Aksi (detik)</label>
                  <input name="actionDuration" type="number" min="1" max="60" className="input" required defaultValue={editing?.actionDuration ?? 5} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-2"><Coffee className="w-4 h-4 text-amber-400" /> Istirahat (detik)</label>
                  <input name="restDuration" type="number" min="1" max="30" className="input" required defaultValue={editing?.restDuration ?? 3} />
                </div>
                <div>
                  <label className="label flex items-center gap-2"><RotateCw className="w-4 h-4 text-teal-400" /> Repetisi</label>
                  <input name="repetitionCount" type="number" min="1" max="100" className="input" required defaultValue={editing?.repetitionCount ?? 10} />
                </div>
              </div>

              {/* Schedule Protocol Inputs */}
              <div className="pt-2 border-t border-white/10 space-y-3">
                <p className="text-xs font-bold text-teal-300 uppercase tracking-wider">Protokol Jadwal & Pemulihan Otot</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Batas Pagi (Jam WIB)</label>
                    <input
                      name="morningCutoffHour"
                      type="number"
                      min="1"
                      max="23"
                      className="input"
                      required
                      defaultValue={editing?.morningCutoffHour ?? 12}
                    />
                    <span className="text-[10px] text-white/50 block mt-0.5">&lt; jam ini = Pagi, &ge; jam ini = Sore</span>
                  </div>
                  <div>
                    <label className="label">Jeda Min. Otot (Jam)</label>
                    <input
                      name="minRestIntervalHours"
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="24"
                      className="input"
                      required
                      defaultValue={editing?.minRestIntervalHours ?? 4.0}
                    />
                    <span className="text-[10px] text-white/50 block mt-0.5">Jeda minimal sebelum sesi sore</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn btn-primary flex-1">
                  {editing ? 'Simpan' : 'Buat'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null) }}>
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Config List */}
      {configs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Semua Konfigurasi
          </h2>
          {configs.map((c) => (
            <div key={c.id} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {c.preparationDuration}s / {c.actionDuration}s / {c.restDuration}s × {c.repetitionCount}
                  </p>
                </div>
                {c.isActive && <span className="badge badge-success">Aktif</span>}
              </div>
              <div className="flex gap-2">
                {!c.isActive && (
                  <button className="btn btn-secondary text-xs py-1.5 px-3" onClick={() => handleSetActive(c.id)}>
                    Aktifkan
                  </button>
                )}
                <button className="btn btn-ghost text-xs py-1.5 px-3" onClick={() => { setEditing(c); setShowForm(true) }}>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PhaseCard({ label, value, unit, color, icon }: { label: string; value: number; unit: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="text-center p-4 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex justify-center">{icon}</div>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit} {label}</p>
    </div>
  )
}
