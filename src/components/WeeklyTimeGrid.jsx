// filepath: c:\Users\XH\time-share-app\src\components\WeeklyTimeGrid.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function getLocalDate() {
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
  return (
    Array.isArray(value) &&
    value.every(
      (slot) =>
        slot &&
        typeof slot.id === 'string' &&
        typeof slot.date === 'string' &&
        typeof slot.startTime === 'string' &&
        typeof slot.endTime === 'string' &&
        typeof slot.available === 'boolean',
    )
  )
}

export default function WeeklyTimeGrid() {
  const [slots, setSlots] = useState([])
  const [date, setDate] = useState(getLocalDate())
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [copyState, setCopyState] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

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

      if (!data) {
        setError('没有找到这条分享记录。')
        return
      }

      if (!isTimeSlotArray(data.availability)) {
        setError('这条记录不是新版时间段格式，请重新创建分享。')
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
      {
        id: createId(),
        date,
        startTime,
        endTime,
        available: true,
      },
    ])
    setStartTime('')
    setEndTime('')
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
      window.setTimeout(() => setCopyState(''), 1500)
    } catch {
      setError('复制失败，请手动复制分享链接。')
    }
  }

  const sortedSlots = [...slots].sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
  )
  const availableCount = slots.filter((slot) => slot.available).length
  const unavailableCount = slots.length - availableCount

  return (
    <section className="w-full max-w-3xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_18px_50px_-36px_rgba(31,41,35,0.35)]">
      <header className="border-b border-stone-200 px-5 py-5 sm:px-7">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
          时间安排
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          添加可用时间段
        </h1>
      </header>

      <div className="space-y-6 p-5 sm:p-7">
        <form
          onSubmit={addSlot}
          className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <label className="space-y-1 text-sm font-medium text-stone-700">
            日期
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-stone-700">
            开始时间
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-stone-700">
            结束时间
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
            />
          </label>

          <button
            type="submit"
            className="self-end rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            添加
          </button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-stone-900">时间段列表</h2>
            <span className="text-sm text-stone-500">
              有空 {availableCount} · 没空 {unavailableCount}
            </span>
          </div>

          {sortedSlots.length === 0 ? (
            <p className="rounded-lg bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
              还没有添加时间段。
            </p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {sortedSlots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="text-sm font-medium text-stone-800">
                    {slot.date}　{slot.startTime} - {slot.endTime}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.id)}
                      aria-pressed={slot.available}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                        slot.available
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                      }`}
                    >
                      {slot.available ? '有空' : '没空'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                      aria-label={`删除 ${slot.date} ${slot.startTime} 的时间段`}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveSlots}
            disabled={isSaving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存时间网格'}
          </button>

          {shareUrl && (
            <button
              type="button"
              onClick={copyShareLink}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              {copyState || '复制分享链接'}
            </button>
          )}
        </div>

        {shareUrl && (
          <p className="break-all text-sm text-stone-600">
            分享链接：
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 underline"
            >
              {shareUrl}
            </a>
          </p>
        )}
      </div>
    </section>
  )
}