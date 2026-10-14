// filepath: c:\Users\XH\time-share-app\src\components\WeeklyTimeGrid.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const PERIODS = ['上午', '下午', '晚上']
const SLOT_COUNT = DAYS.length * PERIODS.length

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

function getSlotKey(dayIndex, periodIndex) {
  return `${dayIndex}-${periodIndex}`
}

function isBooleanArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'boolean')
}

function buildStatusesFromAvailability(availability) {
  if (!Array.isArray(availability) || availability.length !== SLOT_COUNT) {
    return {}
  }

  return availability.reduce((result, value, index) => {
    const dayIndex = Math.floor(index / PERIODS.length)
    const periodIndex = index % PERIODS.length
    const key = getSlotKey(dayIndex, periodIndex)

    if (value === true) {
      result[key] = true
    } else if (value === false) {
      result[key] = false
    }

    return result
  }, {})
}

function getAvailabilityArrayFromStatuses(statusMap) {
  return DAYS.flatMap((_, dayIndex) =>
    PERIODS.map((_, periodIndex) => {
      const key = getSlotKey(dayIndex, periodIndex)
      return statusMap[key] === true
    }),
  )
}

function parseRawAvailabilityInput(value) {
  if (!value) return []

  let normalized = value
    .replace(/\s+/g, '')
    .replace(/\[|\]|\{|\}/g, '')
    .replace(/;/g, ',')
    .replace(/"/g, '')

  if (!normalized) return []

  const itemList = normalized.split(',').filter(Boolean)
  if (itemList.length === 0) return []

  const result = itemList.map((item) => {
    const lowered = item.toLowerCase()
    if (lowered === 'true' || lowered === '1' || lowered === 't') return true
    if (lowered === 'false' || lowered === '0' || lowered === 'f') return false
    return null
  })

  if (result.some((slot) => slot === null)) {
    return []
  }

  return result
}

function extractShareIds(input) {
  if (!input || !input.trim()) return []

  const matchSet = new Set()
  const seen = new Set()

  input
    .split(/\s+|,|\n|\r/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const extracted = entry.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/)?.[0]
      if (extracted) {
        matchSet.add(extracted)
      } else if (entry.includes('share=')) {
        const fromQuery = entry.split('share=')[1]?.split(/[&?#]/)[0]
        if (fromQuery) matchSet.add(fromQuery)
      } else if (/^[0-9a-fA-F-]{36}$/.test(entry)) {
        matchSet.add(entry)
      }
    })

  matchSet.forEach((id) => seen.add(id))
  return [...seen]
}

function getHeatColor(ratio) {
  if (ratio <= 0) return 'bg-red-900 text-white'
  if (ratio < 0.2) return 'bg-red-700 text-white'
  if (ratio < 0.4) return 'bg-orange-500 text-white'
  if (ratio < 0.6) return 'bg-yellow-300 text-stone-900'
  if (ratio < 0.8) return 'bg-lime-400 text-stone-900'
  return 'bg-emerald-700 text-white'
}

export default function WeeklyTimeGrid() {
  const [statusMap, setStatusMap] = useState({})
  const [shareUrl, setShareUrl] = useState('')
  const [copyState, setCopyState] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [importText, setImportText] = useState('')
  const [otherShareInput, setOtherShareInput] = useState('')
  const [sharedRecords, setSharedRecords] = useState([])
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [showOnlyAllAvailable, setShowOnlyAllAvailable] = useState(false)

  const allAvailableCount = useMemo(
    () => Object.keys(statusMap).filter((key) => statusMap[key] === true).length,
    [statusMap],
  )

  const totalSelectedCount = Object.keys(statusMap).filter((key) => statusMap[key] !== undefined).length

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

      if (!data || !Array.isArray(data.availability)) {
        setError('没有找到这条分享记录。')
        return
      }

      if (!isBooleanArray(data.availability) || data.availability.length !== SLOT_COUNT) {
        setError('分享内容格式不正确，必须是 21 个布尔值。')
        return
      }

      setStatusMap(buildStatusesFromAvailability(data.availability))
      setShareUrl(window.location.href)
    }

    loadSharedSlots()
  }, [])

  function cycleSlotStatus(dayIndex, periodIndex) {
    const key = getSlotKey(dayIndex, periodIndex)

    setStatusMap((current) => {
      const next = { ...current }
      const value = current[key]

      if (value === undefined) {
        next[key] = true
      } else if (value === true) {
        next[key] = false
      } else {
        delete next[key]
      }

      return next
    })
  }

  function applyImportedAvailability(rawText) {
    const parsed = parseRawAvailabilityInput(rawText)

    if (parsed.length !== SLOT_COUNT) {
      setError('导入内容必须是 21 个布尔值，顺序按 周一上午、周一下午、周一晚上 ... 周日晚上。')
      return
    }

    setError('')
    setStatusMap(buildStatusesFromAvailability(parsed))
    setSelectedSlot(null)
  }

  async function saveToSupabase() {
    if (!supabase) {
      setError('缺少 Supabase 配置，请检查 .env.local。')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const shareId = new URLSearchParams(window.location.search).get('share')
      const availability = getAvailabilityArrayFromStatuses(statusMap)
      let savedId = shareId

      if (shareId) {
        const { data, error: updateError } = await supabase
          .from('shared_availability')
          .update({ availability })
          .eq('id', shareId)
          .select('id')
          .maybeSingle()

        if (updateError) throw updateError
        if (!data) throw new Error('找不到可更新的分享记录。')
        savedId = data.id
      } else {
        const { data, error: insertError } = await supabase
          .from('shared_availability')
          .insert([{ id: createId(), availability }])
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

  async function loadSharedRecords() {
    if (!supabase) {
      setError('缺少 Supabase 配置，请检查 .env.local。')
      return
    }

    const ids = extractShareIds(otherShareInput)

    if (ids.length === 0) {
      setError('请输入分享链接或 UUID。')
      return
    }

    setError('')

    const { data, error: loadError } = await supabase
      .from('shared_availability')
      .select('id, availability')
      .in('id', ids)

    if (loadError) {
      setError(`读取共享记录失败：${loadError.message}`)
      return
    }

    if (!data || data.length === 0) {
      setError('没有查询到这些分享记录。')
      return
    }

    const normalized = data
      .filter((row) => Array.isArray(row.availability) && row.availability.length === SLOT_COUNT)
      .map((row, index) => ({
        id: row.id,
        name: `成员 ${index + 1}`,
        availability: row.availability,
      }))

    if (normalized.length === 0) {
      setError('查询到的分享记录格式不匹配。')
      return
    }

    setSharedRecords(normalized)
    setSelectedSlot(null)
  }

  const heatmapSlots = useMemo(() => {
    const totalPeople = sharedRecords.length || 0

    return Array.from({ length: SLOT_COUNT }, (_, index) => {
      const dayIndex = Math.floor(index / PERIODS.length)
      const periodIndex = index % PERIODS.length
      const availableCount = sharedRecords.filter((person) => person.availability[index] === true).length
      const ratio = totalPeople === 0 ? 0 : availableCount / totalPeople

      return {
        index,
        dayIndex,
        periodIndex,
        label: `${DAYS[dayIndex]} ${PERIODS[periodIndex]}`,
        availableCount,
        totalPeople,
        ratio,
        persons: sharedRecords
          .filter((person) => person.availability[index] === true)
          .map((person) => person.name),
      }
    })
  }, [sharedRecords])

  const visibleHeatmapSlots = showOnlyAllAvailable
    ? heatmapSlots.filter((slot) => slot.totalPeople > 0 && slot.availableCount === slot.totalPeople)
    : heatmapSlots

  const selectedHeatmapSlot = selectedSlot !== null ? heatmapSlots[selectedSlot] : null
  const summaryMessage =
    selectedHeatmapSlot && selectedHeatmapSlot.totalPeople > 0
      ? `${selectedHeatmapSlot.label}：${selectedHeatmapSlot.availableCount}/${selectedHeatmapSlot.totalPeople} 人有空`
      : '点击任意格子查看具体成员名单'

  const importSummary = `${allAvailableCount} 个已选中的可用时段 · ${totalSelectedCount} 个已填写状态`

  return (
    <section className="w-full max-w-6xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_22px_80px_-38px_rgba(15,23,42,0.45)]">
      <header className="border-b border-stone-200 px-5 py-5 sm:px-7">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
          周时间协作
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          可用时间网格与多人热力图
        </h1>
      </header>

      <div className="grid gap-6 p-5 sm:p-7 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-stone-900">我的可用时间</h2>
              <span className="text-sm text-stone-500">{importSummary}</span>
            </div>

            <div className="mb-4 rounded-xl border border-stone-200 bg-white p-3">
              <label className="mb-2 block text-sm font-medium text-stone-700">
                批量导入（21 个布尔值）
              </label>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="例如：[1,0,1,1,0,0,1,0,1,1,0,0,1,1,0,0,1,1,0,1,0]"
                className="min-h-[96px] w-full resize-none rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none ring-0 transition focus:border-emerald-500"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyImportedAvailability(importText)}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                  导入到我的网格
                </button>
                <button
                  type="button"
                  onClick={() => setImportText(getAvailabilityArrayFromStatuses(statusMap).join(','))}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                >
                  生成当前导出值
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                <div />
                {PERIODS.map((period) => (
                  <div key={period} className="text-center">
                    {period}
                  </div>
                ))}
              </div>

              {DAYS.map((day, dayIndex) => (
                <div
                  key={day}
                  className="grid grid-cols-[72px_repeat(3,minmax(0,1fr))] gap-2 border-b border-stone-200 px-3 py-3 last:border-b-0"
                >
                  <div className="flex items-center text-sm font-semibold text-stone-700">{day}</div>
                  {PERIODS.map((period, periodIndex) => {
                    const key = getSlotKey(dayIndex, periodIndex)
                    const value = statusMap[key]

                    const buttonClass =
                      value === true
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : value === false
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-stone-200 text-stone-500 hover:bg-stone-300'

                    return (
                      <button
                        key={`${day}-${period}`}
                        type="button"
                        onClick={() => cycleSlotStatus(dayIndex, periodIndex)}
                        className={`rounded-xl px-2 py-4 text-sm font-semibold transition ${buttonClass}`}
                        title={`${day} ${period}`}
                      >
                        {value === true ? '有空' : value === false ? '没空' : '未选'}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-stone-900">分享与导出</h2>
              <span className="text-sm text-stone-500">兼容 `shared_availability` 表</span>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveToSupabase}
                disabled={isSaving}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '生成分享链接'}
              </button>

              {shareUrl && (
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                >
                  {copyState || '复制分享链接'}
                </button>
              )}
            </div>

            {shareUrl && (
              <p className="mt-3 break-all text-sm text-stone-700">
                分享链接：
                <a href={shareUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                  {shareUrl}
                </a>
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-stone-900">多人可见性</h2>
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={showOnlyAllAvailable}
                  onChange={(event) => setShowOnlyAllAvailable(event.target.checked)}
                />
                全员有空
              </label>
            </div>

            <textarea
              value={otherShareInput}
              onChange={(event) => setOtherShareInput(event.target.value)}
              placeholder="粘贴其他人的分享链接或 UUID，例如：...share=xxx ..."
              className="min-h-[96px] w-full resize-none rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={loadSharedRecords}
              className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              加载共享视图
            </button>

            {sharedRecords.length > 0 && (
              <div className="mt-4 rounded-xl border border-stone-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.12em] text-stone-500">
                  <span>连续热力图</span>
                  <span>{sharedRecords.length} 人</span>
                </div>

                <div className="space-y-2">
                  {DAYS.map((day, dayIndex) => (
                    <div key={day} className="grid grid-cols-3 gap-2">
                      {PERIODS.map((period, periodIndex) => {
                        const slot = visibleHeatmapSlots.find(
                          (item) => item.dayIndex === dayIndex && item.periodIndex === periodIndex,
                        )

                        if (!slot) {
                          return <div key={`${day}-${period}`} className="h-12 rounded-lg bg-stone-200" />
                        }

                        const slotClass = getHeatColor(slot.ratio)

                        return (
                          <button
                            key={`${day}-${period}`}
                            type="button"
                            onClick={() => setSelectedSlot(slot.index)}
                            title={`${slot.label}：${slot.availableCount}/${slot.totalPeople} 人有空`}
                            className={`flex h-12 items-center justify-center rounded-lg text-xs font-semibold transition hover:brightness-105 ${slotClass}`}
                          >
                            {slot.availableCount}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-700">
              <p className="mb-2 font-semibold text-stone-900">可视化说明</p>
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>低参与度</span>
                <span>高参与度</span>
              </div>
              <div className="mt-2 grid grid-cols-6 gap-1">
                {[
                  'bg-red-900',
                  'bg-red-700',
                  'bg-orange-500',
                  'bg-yellow-300',
                  'bg-lime-400',
                  'bg-emerald-700',
                ].map((colorClass, index) => (
                  <span key={index} className={`h-3 rounded ${colorClass}`} />
                ))}
              </div>
            </div>

            {selectedHeatmapSlot && (
              <div className="mt-4 rounded-xl border border-stone-200 bg-white p-3">
                <p className="mb-2 text-sm font-semibold text-stone-900">{summaryMessage}</p>
                {selectedHeatmapSlot.persons.length > 0 ? (
                  <ul className="space-y-1 text-sm text-stone-700">
                    {selectedHeatmapSlot.persons.map((person) => (
                      <li key={person}>• {person}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-stone-500">当前时段没有人可用。</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {error && (
        <div className="border-t border-stone-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 sm:px-7">
          {error}
        </div>
      )}
    </section>
  )
}
