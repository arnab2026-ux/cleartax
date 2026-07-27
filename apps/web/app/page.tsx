const phases = [
  { name: "Tax engine (regime computation)", status: "pending" },
  { name: "Form 16 upload & parsing", status: "pending" },
  { name: "Guided income & deductions wizard", status: "pending" },
  { name: "Old vs new regime comparison", status: "pending" },
  { name: "Official ITR JSON export", status: "pending" },
  { name: "Filing (mock provider only)", status: "pending" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Personal ITR Assistant
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Scaffold is up. Feature phases land incrementally — see{" "}
          <code className="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">
            PROGRESS.md
          </code>{" "}
          in the repo for current status.
        </p>
        <ul className="flex flex-col gap-2">
          {phases.map((phase) => (
            <li
              key={phase.name}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
            >
              <span className="text-zinc-800 dark:text-zinc-200">{phase.name}</span>
              <span className="text-zinc-400">{phase.status}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
