import WeeklyTimeGrid from './components/WeeklyTimeGrid'

function App() {
  return (
    <main className="min-h-screen bg-[#f5f6f2] px-4 py-8 text-stone-900 sm:px-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
        <WeeklyTimeGrid />
      </div>
    </main>
  )
}

export default App