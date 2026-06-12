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
  parent_id: number | null;
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

  // Top-level tasks (parent_id = null) with their sub-tasks nested underneath.
  const topLevel = tasks.filter((t) => t.parent_id == null);
  const subsOf = (id: number) => tasks.filter((t) => t.parent_id === id);
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.done).length;

  // --- notes (context) ---
  const [notes, setNotes] = useState(activity.notes ?? "");
  const dirty = (notes ?? "") !== (activity.notes ?? "");

  // --- new task input ---
  const [newTask, setNewTask] = useState("");
  const [addingFor, setAddingFor] = useState<number | null>(null); // which task is showing the sub-step input
  const [subText, setSubText] = useState("");
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

  function handleAddSub(e: React.FormEvent, parentId: number) {
    e.preventDefault();
    const t = subText.trim();
    if (!t) return;
    setSubText("");
    setAddingFor(null);
    run(() => addTask(activity.id, t, parentId));
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
          Checklist {total > 0 && `· ${doneCount}/${total}`}
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

        {total === 0 ? (
          <p className="text-xs text-bone-dim font-mono py-2">No steps yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {topLevel.map((t) => {
              const subs = subsOf(t.id);
              return (
                <li key={t.id}>
                  <TaskRow
                    task={t}
                    pending={pending}
                    onToggle={() => run(() => toggleTask(t.id, !t.done))}
                    onDelete={() => run(() => deleteTask(t.id))}
                    onAddSub={() => {
                      setSubText("");
                      setAddingFor((cur) => (cur === t.id ? null : t.id));
                    }}
                  />
                  {(subs.length > 0 || addingFor === t.id) && (
                    <div className="ml-[26px] mt-1 space-y-1 border-l border-border pl-3">
                      {subs.map((s) => (
                        <TaskRow
                          key={s.id}
                          task={s}
                          pending={pending}
                          indent
                          onToggle={() => run(() => toggleTask(s.id, !s.done))}
                          onDelete={() => run(() => deleteTask(s.id))}
                        />
                      ))}
                      {addingFor === t.id && (
                        <form onSubmit={(e) => handleAddSub(e, t.id)} className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={subText}
                            onChange={(e) => setSubText(e.target.value)}
                            placeholder="Add a sub-step…"
                            className="flex-1 rounded-md bg-surface border border-border px-2.5 py-1.5 text-[13px] text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle"
                          />
                          <button
                            type="submit"
                            disabled={pending || !subText.trim()}
                            className="w-7 h-7 grid place-items-center rounded-md bubble-stroke-gradient text-bone disabled:opacity-40 shrink-0"
                            aria-label="Add sub-step"
                          >
                            <Plus size={13} />
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
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
  onAddSub,
  indent,
}: {
  task: Task;
  pending: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onAddSub?: () => void;
  indent?: boolean;
}) {
  const done = !!task.done;
  const box = indent ? "w-[18px] h-[18px]" : "w-5 h-5";
  return (
    <div className="group flex items-center gap-2.5">
      <button
        onClick={onToggle}
        disabled={pending}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`${box} shrink-0 rounded-md grid place-items-center transition ${
          done
            ? "bubble-stroke-gradient text-bone"
            : "border border-border-strong text-transparent hover:border-periwinkle"
        }`}
      >
        <Check size={indent ? 11 : 13} />
      </button>
      <span
        className={`flex-1 ${indent ? "text-[13px]" : "text-sm"} ${
          done ? "text-bone-mute line-through" : indent ? "text-bone-dim" : "text-bone"
        }`}
      >
        {task.title}
      </span>
      {onAddSub && (
        <button
          onClick={onAddSub}
          disabled={pending}
          aria-label="Add sub-step"
          title="Add sub-step"
          className="w-7 h-7 grid place-items-center rounded-md text-bone-mute opacity-60 hover:opacity-100 hover:text-periwinkle transition"
        >
          <Plus size={15} />
        </button>
      )}
      <button
        onClick={onDelete}
        disabled={pending}
        aria-label="Delete task"
        className="w-7 h-7 grid place-items-center rounded-md text-bone-mute opacity-0 group-hover:opacity-100 hover:text-warmred transition"
      >
        <X size={14} />
      </button>
    </div>
  );
}
