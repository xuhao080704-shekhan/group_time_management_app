import { useState } from 'react'

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const periods = [
  { name: '上午', time: '09:00 - 12:00' },
  { name: '下午', time: '13:00 - 18:00' },
  { name: '晚上', time: '18:00 - 21:00' },
]

export default function WeeklyTimeGrid() {
  const [selectedSlots, setSelectedSlots] = useState(() => new Set())

  function toggleSlot(slotId) {
    setSelectedSlots((current) => {
      const next = new Set(current)
      if (next.has(slotId)) {
        next.delete(slotId)
      } else {
        next.add(slotId)
      }
      return next
    })
  }

  return (
    <section className="w-full max-w-6xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_18px_50px_-36px_rgba(31,41,35,0.35)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 px-5 py-5 sm:px-7">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">每周可用时间</p>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">选择你的空闲时段</h1>
        </div>
        <p className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800" aria-live="polite">
          已选择 <span className="font-bold">{selectedSlots.size}</span> 个时段
        </p>
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
                const isSelected = selectedSlots.has(slotId)

                return (
                  <button
                    key={slotId}
                    type="button"
                    aria-label={`${day}${period.name}${isSelected ? '，已选择' : '，未选择'}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleSlot(slotId)}
                    className={`min-h-24 rounded-lg border px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                        : 'border-stone-200 bg-white text-stone-500 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-800'
                    }`}
                  >
                    {isSelected ? '已选' : '选择'}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-stone-200 px-5 py-3 text-xs text-stone-500 sm:px-7">
        <span className="size-2 rounded-sm bg-emerald-700" aria-hidden="true" />
        点击格子即可添加或取消时段
      </div>
    </section>
  )
}