import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const periods = [
  { name: '上午', time: '09:00 - 12:00' },
  { name: '下午', time: '13:00 - 18:00' },
  { name: '晚上', time: '18:00 - 21:00' },
]

function buildStatusesFromAvailability(availability) {
  if (!Array.isArray(availability)) {
    return {}
  }

  const nextStatuses = {}

  availability.forEach((isAvailable, index) => {
    const periodIndex = Math.floor(index / days.length)
    const dayIndex = index % days.length
    const slotId = `${dayIndex}-${periodIndex}`
    nextStatuses[slotId] = isAvailable ? 'available' : 'unavailable'
  })

  return nextStatuses
}

function extractShareIds(input) {
  const matches = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) || []
  return [...new Set(matches.map((id) => id.toLowerCase()))]
}

function getHeatColor(ratio) {
  if (ratio <= 0) {
    return 'rgb(127, 29, 29)'
  }

  if (ratio >= 1) {
    return 'rgb(6, 95, 70)'
  }

  const hue = 40 + ratio * 80
  const lightness = 35 + (1 - ratio) * 35
  return `hsl(${hue}, 82%, ${lightness}%)`
}

export default function WeeklyTimeGrid() {
  const [slotStatuses, setSlotStatuses] = useState({})
  const [shareUrl, setShareUrl] = useState('')
  const [isGeneratingLink, setIsGeneratingLink] = useState(false)
  const [inputIds, setInputIds] = useState('')
  const [isCalculating, setIsCalculating] = useState(false)
  const [heatmapData, setHeatmapData] = useState([])
  const [totalPeople, setTotalPeople] = useState(0)
  const [showOnlyAllAvailable, setShowOnlyAllAvailable] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [copyState, setCopyState] = useState('')

  useEffect(() => {
    if (!supabase) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const shareId = params.get('share')

    if (!shareId) {
      return
    }

    async function loadSharedAvailability() {
      const { data, error } = await supabase
        .from('shared_availability')
        .select('availability')
        .eq('id', shareId)
        .maybeSingle()

      if (error) {
        alert(`读取分享内容失败：${error.message}`)
        return
      }

      if (data?.availability) {
        setSlotStatuses(buildStatusesFromAvailability(data.availability))
        setShareUrl(window.location.href)
      }
    }

    loadSharedAvailability()
  }, [])

  function cycleSlotStatus(slotId) {
    setSlotStatuses((current) => {
      const next = { ...current }
      if (current[slotId] === undefined) {
        next[slotId] = 'available'
      } else if (current[slotId] === 'available') {
        next[slotId] = 'unavailable'
      } else {
        delete next[slotId]
      }
      return next
    })
  }

  function getAvailabilityArray() {
    return periods.flatMap((_, periodIndex) =>
      days.map((_, dayIndex) => slotStatuses[`${dayIndex}-${periodIndex}`] === 'available'),
    )
  }

  async function generateShareLink() {
    if (!supabase) {
      alert('缺少 Supabase 配置，请确认 .env.local 中的 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 已正确填写。')
      return
    }

    const generatedId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `share-${Date.now()}-${Math.random().toString(16).slice(2)}`

    setIsGeneratingLink(true)

    const { error } = await supabase.from('shared_availability').insert([
      {
        id: generatedId,
        availability: getAvailabilityArray(),
      },
    ])

    setIsGeneratingLink(false)

    if (error) {
      alert(`生成分享链接失败：${error.message}`)
      return
    }

    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('share', generatedId)
    const generatedLink = nextUrl.toString()

    setShareUrl(generatedLink)
    setCopyState('')
    alert(`分享链接已生成：${generatedLink}`)
  }

  async function copyShareLink() {
    if (!shareUrl) {
      alert('当前还没有可复制的分享链接。')
      return
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState('已复制')
      window.setTimeout(() => setCopyState(''), 1500)
    } catch (error) {
      alert(`复制失败：${error.message || '未知错误'}`)
    }
  }

  async function calculateCommonTime() {
    if (!supabase) {
      alert('缺少 Supabase 配置，请确认 .env.local 中的 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 已正确填写。')
      return
    }

    const ids = extractShareIds(inputIds)

    if (ids.length === 0) {
      alert('请输入至少一个有效的分享 ID。')
      return
    }

    setIsCalculating(true)

    const { data, error } = await supabase
      .from('shared_availability')
      .select('id, availability')
      .in('id', ids)

    setIsCalculating(false)

    if (error) {
      alert(`查询共享时段失败：${error.message}`)
      return
    }

    if (!data || data.length === 0) {
      alert('没有找到匹配的分享 ID。')
      return
    }

    const foundIds = data.map((item) => item.id)
    const missingIds = ids.filter((id) => !foundIds.includes(id))

    if (missingIds.length > 0) {
      alert(`以下 ID 未找到：${missingIds.join(', ')}`)
    }

    const validData = data.filter((item) => Array.isArray(item.availability))
    const personRecords = validData.map((item) => ({
      id: item.id,
      label: item.id.slice(0, 6),
      availability: item.availability,
    }))

    if (personRecords.length === 0) {
      alert('找到的记录中没有可用的 availability 数据。')
      return
    }

    const totalPeople = personRecords.length
    const slotTotals = Array.from({ length: periods.length * days.length }, (_, index) => {
      let count = 0
      const unavailablePeople = []

      personRecords.forEach((person) => {
        const isAvailable = Boolean(person.availability?.[index])
        if (isAvailable) {
          count += 1
        } else {
          unavailablePeople.push(person.label)
        }
      })

      return {
        index,
        count,
        ratio: totalPeople === 0 ? 0 : count / totalPeople,
        unavailablePeople,
      }
    })

    setHeatmapData(slotTotals)
    setTotalPeople(totalPeople)
    setSelectedSlot(null)
  }

  const filteredHeatmapData = showOnlyAllAvailable
    ? heatmapData.filter((slot) => totalPeople > 0 && slot.count === totalPeople)
    : heatmapData

  const availableCount = Object.values(slotStatuses).filter((status) => status === 'available').length
  const unavailableCount = Object.values(slotStatuses).filter((status) => status === 'unavailable').length

  return (
    <section className="w-full max-w-6xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_18px_50px_-36px_rgba(31,41,35,0.35)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 px-5 py-5 sm:px-7">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">每周可用时间</p>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">选择你的空闲时段</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generateShareLink}
            disabled={isGeneratingLink}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {isGeneratingLink ? '生成中...' : '生成分享链接'}
          </button>

          {shareUrl && (
            <button
              type="button"
              onClick={copyShareLink}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-50"
            >
              {copyState || '复制分享链接'}
            </button>
          )}

          <p className="flex gap-3 rounded-full bg-stone-100 px-3 py-1.5 text-sm font-medium" aria-live="polite">
            <span className="text-emerald-800">有空 <strong>{availableCount}</strong></span>
            <span className="text-rose-800">没空 <strong>{unavailableCount}</strong></span>
          </p>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-7">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <label htmlFor="shared-ids" className="mb-2 block text-sm font-semibold text-stone-700">粘贴多个分享 ID</label>
          <textarea
            id="shared-ids"
            value={inputIds}
            onChange={(event) => setInputIds(event.target.value)}
            rows={5}
            placeholder="例如：
https://xxx/?share=7bb8cae7-33c5-4f8e-b8aa-9a95f8c1ca42
7bb8cae7-33c5-4f8e-b8aa-9a95f8c1ca42, 2b7c8a61-4f12-4d29-a1b0-9ae2d4df9d11"
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={calculateCommonTime}
              disabled={isCalculating}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {isCalculating ? '计算中...' : '计算共同时间'}
            </button>
            <span className="text-xs text-stone-500">会自动提取其中的 UUID，并批量查询共享时段</span>
          </div>
        </div>

        {heatmapData.length > 0 && (
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-stone-900">多人共同空闲热力图</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
                  参与人数：{totalPeople}
                </span>
                <button
                  type="button"
                  onClick={() => setShowOnlyAllAvailable((current) => !current)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${showOnlyAllAvailable ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                >
                  {showOnlyAllAvailable ? '已筛选：全员有空' : '筛选：全员有空'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="grid min-w-[760px] grid-cols-[6.25rem_repeat(7,minmax(0,1fr))] gap-2" role="group" aria-label="多人共同空闲热力图">
                <div aria-hidden="true" />
                {days.map((day, index) => (
                  <div key={day} className="flex h-12 items-center justify-center rounded-lg bg-stone-50 text-sm font-semibold text-stone-700">
                    <span>{day}</span>
                    {index > 4 && <span className="ml-1.5 size-1.5 rounded-full bg-amber-500" aria-label="周末" />}
                  </div>
                ))}

                {periods.map((period, periodIndex) => (
                  <div key={period.name} className="contents">
                    <div className="flex min-h-24 flex-col justify-center pr-2">
                      <span className="text-sm font-semibold text-stone-800">{period.name}</span>
                      <span className="mt-1 text-[11px] tabular-nums text-stone-500">{period.time}</span>
                    </div>

                    {days.map((day, dayIndex) => {
                      const slotIndex = periodIndex * days.length + dayIndex
                      const slot = filteredHeatmapData[slotIndex] ?? heatmapData[slotIndex]
                      const ratio = slot?.ratio ?? 0
                      const availablePeople = slot?.count ?? 0
                      const unavailablePeople = totalPeople - availablePeople
                      const allAvailable = availablePeople === totalPeople && totalPeople > 0
                      const bgColor = getHeatColor(ratio)
                      const missingList = slot?.unavailablePeople?.length ? slot.unavailablePeople.join('、') : '无'
                      const isHidden = showOnlyAllAvailable && !(availablePeople === totalPeople && totalPeople > 0)

                      return (
                        <button
                          key={`${day}-${period.name}`}
                          type="button"
                          title={`${day}${period.name}：当前有 ${availablePeople}/${totalPeople} 人空闲\n没空：${missingList}`}
                          onClick={() => setSelectedSlot({
                            label: `${day}${period.name}`,
                            availablePeople,
                            totalPeople,
                            unavailablePeople,
                            missingList,
                            ratio,
                          })}
                          className={`flex min-h-24 items-center justify-center rounded-lg border px-2 text-center text-xs font-bold shadow-inner transition-transform hover:scale-[1.02] ${isHidden ? 'hidden' : 'block'}`}
                          style={{
                            backgroundColor: bgColor,
                            borderColor: allAvailable ? 'rgba(6, 95, 70, 0.9)' : 'rgba(255,255,255,0.35)',
                            color: ratio >= 0.6 ? '#111827' : '#fff',
                          }}
                        >
                          <div className="leading-tight">
                            <div>{allAvailable ? '全员有空' : `${availablePeople}/${totalPeople}`}</div>
                            <div className="mt-1 text-[10px] opacity-90">{unavailablePeople > 0 ? `${unavailablePeople} 人没空` : '全员空闲'}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {selectedSlot && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="mb-1 font-semibold">{selectedSlot.label}</div>
                <div>当前有 {selectedSlot.availablePeople}/{selectedSlot.totalPeople} 人空闲</div>
                <div className="mt-1">没空：{selectedSlot.missingList}</div>
              </div>
            )}

            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="mb-2 text-sm font-semibold text-stone-700">图例</div>
              <div className="flex items-center gap-3 text-xs text-stone-600">
                <span>0%</span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full border border-stone-300">
                  {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                    <div
                      key={value}
                      className="h-full flex-1"
                      style={{ backgroundColor: getHeatColor(value) }}
                    />
                  ))}
                </div>
                <span>100%</span>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-stone-500">
                <span>0 人空闲</span>
                <span>50% 空闲</span>
                <span>全员空闲</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto p-3 sm:p-5">
        <div className="grid min-w-[760px] grid-cols-[6.25rem_repeat(7,minmax(0,1fr))] gap-2" role="group" aria-label="每周空闲时间">
          <div aria-hidden="true" />
          {days.map((day, index) => (
            <div key={day} className="flex h-12 items-center justify-center rounded-lg bg-stone-50 text-sm font-semibold text-stone-700">
              <span>{day}</span>
              {index > 4 && <span className="ml-1.5 size-1.5 rounded-full bg-amber-500" aria-label="周末" />}
            </div>
          ))}

          {periods.map((period, periodIndex) => (
            <div key={period.name} className="contents">
              <div className="flex min-h-24 flex-col justify-center pr-2">
                <span className="text-sm font-semibold text-stone-800">{period.name}</span>
                <span className="mt-1 text-[11px] tabular-nums text-stone-500">{period.time}</span>
              </div>
              {days.map((day, dayIndex) => {
                const slotId = `${dayIndex}-${periodIndex}`
                const status = slotStatuses[slotId]
                const statusLabel = status === 'available' ? '有空' : status === 'unavailable' ? '没空' : '未设置'
                const statusClass = status === 'available'
                  ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                  : status === 'unavailable'
                    ? 'border-rose-700 bg-rose-700 text-white hover:bg-rose-800'
                    : 'border-stone-200 bg-stone-100 text-stone-500 hover:border-stone-400 hover:bg-stone-200'

                return (
                  <button
                    key={slotId}
                    type="button"
                    aria-label={`${day}${period.name}，${statusLabel}`}
                    aria-pressed={status !== undefined}
                    onClick={() => cycleSlotStatus(slotId)}
                    className={`min-h-24 rounded-lg border px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${statusClass}`}
                  >
                    {statusLabel}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {shareUrl && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-3 text-sm text-stone-700 sm:px-7">
          <span className="mr-2 font-semibold">分享链接：</span>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="break-all text-emerald-700 underline decoration-emerald-600 underline-offset-2">
            {shareUrl}
          </a>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-stone-200 px-5 py-3 text-xs text-stone-500 sm:px-7">
        <span className="size-2 rounded-sm bg-emerald-700" aria-hidden="true" />
        点击格子循环切换：未设置 → 有空 → 没空
      </div>
    </section>
  )
}