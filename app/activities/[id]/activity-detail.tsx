"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Plus,
  X,
  Loader2,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  addTask,
  toggleTask,
  deleteTask,
  saveActivityNotes,
  setActivityStatus,
  archiveActivity,
  type ActivityStatus,
} from "../actions";

export type Activity = {
  id: number;
  title: string;
  category: string | null;
  status: ActivityStatus;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

export type Task = {
  id: number;
  title: string;
  done: number; // 0 | 1
  done_at: string | null;
};

const STATUSES: ActivityStatus[] = ["active", "paused", "done"];

export function ActivityDetail({
  activity,
  tasks,
}: {
  activity: Activity;
  tasks: Task[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  // --- notes (context) ---
  const [notes, setNotes] = useState(activity.notes ?? "");
  const dirty = (notes ?? "") !== (activity.notes ?? "");

  // --- new task input ---
  const [newTask, setNewTask] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    const t = newTask.trim();
    if (!t) return;
    setNewTask("");
    run(() => addTask(activity.id, t));
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Status */}
      <div className="flex items-center gap-2">
        {STATUSES.map((s) => {
          const on = activity.status === s;
          return (
            <button
              key={s}
              onClick={() => !on && run(() => setActivityStatus(activity.id, s))}
              disabled={pending}
              className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-[0.14em] transition ${
                on
                  ? "bubble-stroke-gradient text-bone"
                  : "border border-border text-bone-dim hover:text-bone"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Tasks */}
      <section>
        <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-2">
          Checklist {tasks.length > 0 && `· ${done.length}/${tasks.length}`}
        </div>

        <form onSubmit={handleAddTask} className="flex items-center gap-2 mb-3">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add a step…"
            className="flex-1 rounded-lg bg-surface border border-border px-3 py-2 text-sm text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
          <button
            type="submit"
            disabled={pending || !newTask.trim()}
            className="w-9 h-9 grid place-items-center rounded-lg bubble-stroke-gradient text-bone disabled:opacity-40 shrink-0"
            aria-label="Add task"
          >
            <Plus size={16} />
          </button>
        </form>

        {open.length === 0 && done.length === 0 ? (
          <p className="text-xs text-bone-dim font-mono py-2">No steps yet.</p>
        ) : (
          <ul className="space-y-1">
            {open.map((t) => (
              <TaskRow key={t.id} task={t} pending={pending} onToggle={() => run(() => toggleTask(t.id, true))} onDelete={() => run(() => deleteTask(t.id))} />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-bone-mute hover:text-bone-dim font-mono"
            >
              {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {done.length} completed
            </button>
            {showDone && (
              <ul className="space-y-1 mt-1">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} pending={pending} onToggle={() => run(() => toggleTask(t.id, false))} onDelete={() => run(() => deleteTask(t.id))} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Context notes */}
      <section>
        <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-2">
          Context notes
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="What this is, where it stands, anything Nillad should know to help."
          className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
        />
        {dirty && (
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => run(() => saveActivityNotes(activity.id, notes))}
              disabled={pending}
              className="gradient-pill px-4 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save notes
            </button>
            <button
              onClick={() => setNotes(activity.notes ?? "")}
              disabled={pending}
              className="text-bone-dim text-sm hover:text-bone transition"
            >
              Revert
            </button>
          </div>
        )}
      </section>

      {/* Archive */}
      <section className="pt-2">
        {confirmArchive ? (
          <div className="rounded-xl border border-warmred/40 bg-warmred/[0.06] px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-warmred shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-bone font-medium">Archive this activity?</p>
              <p className="text-xs text-bone-dim mt-0.5">
                It’s hidden from your list. Its notes and task history are kept.
              </p>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await archiveActivity(activity.id);
                      router.push("/activities");
                      router.refresh();
                    })
                  }
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-warmred text-bone text-sm font-medium hover:bg-warmred-soft transition disabled:opacity-50"
                >
                  {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Archive
                </button>
                <button
                  onClick={() => setConfirmArchive(false)}
                  disabled={pending}
                  className="text-bone-dim text-sm hover:text-bone transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmArchive(true)}
            className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft transition"
          >
            <Trash2 size={14} /> Archive activity
          </button>
        )}
      </section>
    </div>
  );
}

function TaskRow({
  task,
  pending,
  onToggle,
  onDelete,
}: {
  task: Task;
  pending: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = !!task.done;
  return (
    <li className="group flex items-center gap-2.5">
      <button
        onClick={onToggle}
        disabled={pending}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`w-5 h-5 shrink-0 rounded-md grid place-items-center transition ${
          done
            ? "bubble-stroke-gradient text-bone"
            : "border border-border-strong text-transparent hover:border-periwinkle"
        }`}
      >
        <Check size={13} />
      </button>
      <span
        className={`flex-1 text-sm ${done ? "text-bone-mute line-through" : "text-bone"}`}
      >
        {task.title}
      </span>
      <button
        onClick={onDelete}
        disabled={pending}
        aria-label="Delete task"
        className="w-7 h-7 grid place-items-center rounded-md text-bone-mute opacity-0 group-hover:opacity-100 hover:text-warmred transition"
      >
        <X size={14} />
      </button>
    </li>
  );
}
