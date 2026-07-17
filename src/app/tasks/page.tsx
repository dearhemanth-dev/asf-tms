export default function TasksPage() {
  return (
    <main className="theme-page-shell min-h-screen px-4 py-8 md:px-6 text-white">
      <div className="glass mx-auto max-w-5xl rounded-3xl p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Ops Queue</p>
        <h1 className="mt-2 text-2xl font-black">Task Console</h1>
        <p className="mt-2 text-sm text-slate-300">
          This view is ready for dispatch tasks, driver updates, and approval workflows.
        </p>
      </div>
    </main>
  );
}
