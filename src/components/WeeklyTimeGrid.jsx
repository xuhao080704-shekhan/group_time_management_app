import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const DAY_TICKS = [0, 6, 12, 18, 24]

function getTodayDate() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10)
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function isTimeSlotArray(value) {
  return Array.isArray(value) && value.every((slot) => {
    if (!slot || typeof slot !== 'object') return false

    return (
      typeof slot.id === 'string' &&
      typeof slot.date === 'string' &&
      typeof slot.startTime === 'string' &&
      typeof slot.endTime === 'string' &&
      typeof slot.available === 'boolean'
    )
  })
}

function getMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function getTimelinePosition(time, isEnd = false) {
  const minutes = time === '24:00' && isEnd ? 1440 : getMinutes(time)
  return Math.min(100, Math.max(0, (minutes / 1440) * 100))
}

function parseShareIds(input) {
  const entries = input.split(/[\s,]+/).filter(Boolean)
  const ids = entries.map((entry) => {
    try {
      const url = new URL(entry)
      return url.searchParams.get('share') || entry
    } catch {
      return entry
    }
  })

  return [...new Set(ids.filter(Boolean))]
}

function groupSlotsByDate(slots) {
  return slots.reduce((groups, slot) => {
    groups[slot.date] ??= []
    groups[slot.date].push(slot)
    return groups
  }, {})
}

function TimeAxis({ className = '' }) {
  return (
    <div className={`relative h-5 text-[10px] text-stone-500 ${className}`} aria-hidden="true">
      {DAY_TICKS.map((hour) => (
        <span
          key={hour}
          className="absolute top-0 -translate-x-1/2 tabular-nums"
          style={{ left: `${(hour / 24) * 100}%` }}
        >
          {hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`}
        </span>
      ))}
    </div>
  )
}

function TimelineBar({ slot, compact = false }) {
  const left = getTimelinePosition(slot.startTime)
  const right = getTimelinePosition(slot.endTime, true)
  const width = Math.max(right - left, 0.7)

  return (
    <div className={`relative ${compact ? 'h-6' : 'h-8'}`}>
      <div className="absolute inset-0 rounded bg-stone-100" />
      {DAY_TICKS.map((hour) => (
        <span
          key={hour}
          className="absolute inset-y-0 border-l border-stone-200"
          style={{ left: `${(hour / 24) * 100}%` }}
          aria-hidden="true"
        />
      ))}
      <div
        className={`absolute inset-y-0.5 flex min-w-0 items-center overflow-hidden rounded px-1.5 text-[10px] font-semibold leading-none ${
          slot.available ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${slot.startTime} - ${slot.endTime} · ${slot.available ? '有空' : '没空'}`}
      >
        <span className="truncate">{slot.startTime}–{slot.endTime}</span>
      </div>
    </div>
  )
}

export default function WeeklyTimeGrid() {
  const [slots, setSlots] = useState([])
  const [date, setDate] = useState(getTodayDate())
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('12:30')
  const [shareUrl, setShareUrl] = useState('')
  const [copyState, setCopyState] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState('mine')
  const [shareIdsInput, setShareIdsInput] = useState('')
  const [participants, setParticipants] = useState([])
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false)

  useEffect(() => {
    if (!supabase) return

    const shareId = new URLSearchParams(window.location.search).get('share')
    if (!shareId) return

    async function loadSharedSlots() {
      const { data, error: loadError } = await supabase
        .from('shared_availability')
        .select('availability')
        .eq('id', shareId)
        .maybeSingle()

      if (loadError) {
        setError(`读取分享内容失败：${loadError.message}`)
        return
      }

      if (!data || !data.availability) {
        setError('没有找到这条分享记录。')
        return
      }

      if (!isTimeSlotArray(data.availability)) {
        setError('这条记录不是当前时间段格式，请重新创建分享。')
        return
      }

      setSlots(data.availability)
      setShareUrl(window.location.href)
    }

    loadSharedSlots()
  }, [])

  function addSlot(event) {
    event.preventDefault()
    setError('')

    if (!date || !startTime || !endTime) {
      setError('请选择日期并填写开始和结束时间。')
      return
    }

    if (startTime >= endTime) {
      setError('结束时间必须晚于开始时间。')
      return
    }

    setSlots((current) => [
      ...current,
      { id: createId(), date, startTime, endTime, available: true },
    ])
    setStartTime('10:00')
    setEndTime('12:30')
  }

  function toggleSlot(slotId) {
    setSlots((current) =>
      current.map((slot) =>
        slot.id === slotId ? { ...slot, available: !slot.available } : slot,
      ),
    )
  }

  function removeSlot(slotId) {
    setSlots((current) => current.filter((slot) => slot.id !== slotId))
  }

  async function loadParticipants(event) {
    event.preventDefault()
    setError('')

    if (!supabase) {
      setError('缺少 Supabase 配置，请检查 .env.local。')
      return
    }

    const ids = parseShareIds(shareIdsInput)
    if (ids.length === 0) {
      setError('请粘贴一个或多个分享 ID / 分享链接。')
      return
    }

    setIsLoadingParticipants(true)
    try {
      const { data, error: loadError } = await supabase
        .from('shared_availability')
        .select('id, availability')
        .in('id', ids)

      if (loadError) throw loadError

      const loaded = (data || [])
        .filter((record) => isTimeSlotArray(record.availability))
        .map((record, index) => ({
          id: record.id,
          name: `参与者 ${index + 1}`,
          slots: record.availability,
        }))

      setParticipants(loaded)
      setViewMode('group')

      if (loaded.length === 0) {
        setError('没有找到有效的参与者时间记录。')
      } else if (loaded.length < ids.length) {
        setError(`已加载 ${loaded.length} 人；部分 ID 不存在或数据格式不匹配。`)
      }
    } catch (loadError) {
      setError(`加载多人时间失败：${loadError.message || '未知错误'}`)
    } finally {
      setIsLoadingParticipants(false)
    }
  }

  async function saveSlots() {
    if (!supabase) {
      setError('缺少 Supabase 配置，请检查 .env.local。')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const shareId = new URLSearchParams(window.location.search).get('share')
      let savedId = shareId

      if (shareId) {
        const { data, error: updateError } = await supabase
          .from('shared_availability')
          .update({ availability: slots })
          .eq('id', shareId)
          .select('id')
          .maybeSingle()

        if (updateError) throw updateError
        if (!data) throw new Error('找不到可更新的分享记录。')
        savedId = data.id
      } else {
        const { data, error: insertError } = await supabase
          .from('shared_availability')
          .insert([{ id: createId(), availability: slots }])
          .select('id')
          .single()

        if (insertError) throw insertError
        savedId = data.id
      }

      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('share', savedId)
      window.history.replaceState({}, '', nextUrl.toString())
      setShareUrl(nextUrl.toString())
      setCopyState('')
    } catch (saveError) {
      setError(`保存失败：${saveError.message || '未知错误'}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState('已复制')
      window.setTimeout(() => setCopyState(''), 1600)
    } catch {
      setError('复制失败，请手动复制分享链接。')
    }
  }

  const slotsByDate = useMemo(() => groupSlotsByDate(slots), [slots])
  const sortedDates = Object.keys(slotsByDate).sort()
  const previewSlot = { startTime, endTime, available: true }
  const availableCount = slots.filter((slot) => slot.available).length
  const unavailableCount = slots.length - availableCount

  const participantDates = useMemo(() => {
    const dateSet = new Set(slots.map((slot) => slot.date))
    participants.forEach((person) => person.slots.forEach((slot) => dateSet.add(slot.date)))
    return [...dateSet].sort()
  }, [participants, slots])

  return (
    <section className="w-full max-w-5xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_18px_50px_-36px_rgba(31,41,35,0.35)]">
      <header className="border-b border-stone-200 px-5 py-5 sm:px-7">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
          时间安排
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          可用时间
        </h1>
        <div className="mt-4 flex gap-2" role="tablist" aria-label="时间视图">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'mine'}
            onClick={() => setViewMode('mine')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${viewMode === 'mine' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
          >
            我的时间
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'group'}
            onClick={() => setViewMode('group')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${viewMode === 'group' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
          >
            多人对照
          </button>
        </div>
      </header>

      <div className="space-y-6 p-5 sm:p-7">
        {viewMode === 'mine' ? (
          <>
            <form
              onSubmit={addSlot}
              className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[1.1fr_1fr_1fr_auto]"
            >
              <label className="space-y-1 text-sm font-medium text-stone-700">
                日期
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-stone-700">
                开始时间
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-stone-700">
                结束时间
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </label>
              <button
                type="submit"
                className="self-end rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                添加
              </button>
            </form>

            <div className="rounded-xl border border-stone-200 p-4">
              <div className="mb-2 flex justify-between gap-3 text-sm">
                <span className="font-semibold text-stone-800">当天时间预览</span>
                <span className="tabular-nums text-emerald-800">{startTime || '--:--'} – {endTime || '--:--'}</span>
              </div>
              <TimeAxis />
              <TimelineBar slot={previewSlot} />
              <p className="mt-2 text-xs text-stone-500">全天 00:00 – 24:00；绿色表示新增后默认有空。</p>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-stone-900">按日期排列</h2>
              <span className="text-sm text-stone-500">有空 {availableCount} · 没空 {unavailableCount}</span>
            </div>

            {sortedDates.length === 0 ? (
              <p className="rounded-lg bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">还没有添加时间段。</p>
            ) : (
              <div className="space-y-4">
                {sortedDates.map((day) => (
                  <section key={day} className="overflow-hidden rounded-xl border border-stone-200">
                    <h3 className="bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-800">{day}</h3>
                    <div className="px-4 pb-2 pt-3">
                      <div className="grid grid-cols-[minmax(118px,0.7fr)_minmax(0,2fr)_auto] items-center gap-3">
                        <span className="text-xs font-medium text-stone-500">时间段 / 状态</span>
                        <TimeAxis />
                        <span />
                      </div>
                    </div>
                    <ul className="divide-y divide-stone-100 px-4">
                      {[...slotsByDate[day]].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((slot) => (
                        <li key={slot.id} className="grid grid-cols-[minmax(118px,0.7fr)_minmax(0,2fr)_auto] items-center gap-3 py-3">
                          <button
                            type="button"
                            onClick={() => toggleSlot(slot.id)}
                            aria-pressed={slot.available}
                            className={`justify-self-start rounded-full px-2.5 py-1 text-xs font-semibold ${slot.available ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-rose-100 text-rose-800 hover:bg-rose-200'}`}
                          >
                            {slot.startTime}–{slot.endTime} · {slot.available ? '有空' : '没空'}
                          </button>
                          <TimelineBar slot={slot} compact />
                          <button
                            type="button"
                            onClick={() => removeSlot(slot.id)}
                            aria-label={`删除 ${day} ${slot.startTime} 的时间段`}
                            className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                          >
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveSlots}
                disabled={isSaving}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '保存并生成分享链接'}
              </button>
              {shareUrl && (
                <button type="button" onClick={copyShareLink} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                  {copyState || '复制分享链接'}
                </button>
              )}
            </div>
            {shareUrl && <p className="break-all text-sm text-stone-600">分享链接：<a href={shareUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">{shareUrl}</a></p>}
          </>
        ) : (
          <>
            <form onSubmit={loadParticipants} className="space-y-3">
              <label className="block space-y-1 text-sm font-medium text-stone-700">
                参与者分享 ID 或链接
                <textarea
                  value={shareIdsInput}
                  onChange={(event) => setShareIdsInput(event.target.value)}
                  rows={3}
                  placeholder="粘贴一个或多个 ID / 链接，用空格或逗号分隔"
                  className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
                />
              </label>
              <button
                type="submit"
                disabled={isLoadingParticipants}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
              >
                {isLoadingParticipants ? '加载中...' : '加载参与者时间'}
              </button>
            </form>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600">
              <span className="font-semibold text-stone-800">每一行是一段时间，横轴始终覆盖 24 小时</span>
              <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-emerald-600" />有空</span>
              <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-rose-600" />没空</span>
            </div>

            {participants.length > 0 && participantDates.length > 0 ? (
              <div className="space-y-5">
                {participantDates.map((day) => {
                  const dayRows = [
                    { id: 'mine', name: '我', slots: slots.filter((slot) => slot.date === day) },
                    ...participants.map((person) => ({
                      id: person.id,
                      name: person.name,
                      slots: person.slots.filter((slot) => slot.date === day),
                    })),
                  ].flatMap((person) => person.slots.map((slot, index) => ({
                    ...person,
                    slot,
                    rowKey: `${person.id}-${slot.id}-${index}`,
                    firstForPerson: index === 0,
                  })))

                  return (
                    <section key={day} className="overflow-hidden rounded-xl border border-stone-200">
                      <h3 className="bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-800">{day}</h3>
                      <div className="overflow-x-auto px-4 pb-3 pt-3">
                        <div className="min-w-[620px]">
                          <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
                            <span className="text-xs font-medium text-stone-500">参与者 / 时段</span>
                            <TimeAxis />
                          </div>
                          {dayRows.length === 0 ? (
                            <p className="py-5 text-sm text-stone-500">当天暂无已加载的时间段。</p>
                          ) : (
                            <ul className="divide-y divide-stone-100">
                              {dayRows.map((row) => (
                                <li key={row.rowKey} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 py-2">
                                  <span className="truncate text-xs text-stone-600" title={`${row.name} ${row.slot.startTime}-${row.slot.endTime}`}>
                                    {row.firstForPerson ? row.name : ''} {row.slot.startTime}
                                  </span>
                                  <TimelineBar slot={row.slot} compact />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </section>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-lg bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">加载分享 ID 后，这里会按日期显示自己和参与者的 24 小时时间轴。</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}