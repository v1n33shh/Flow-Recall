"use client";

import { useState } from "react";
import { addRawText } from "@/lib/readerStorage";
import type { BookMeta } from "@/lib/types";

export default function PasteTextForm({ onImported }: { onImported: (book: BookMeta) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (text.trim().length === 0) return;
    setSaving(true);
    try {
      const book = await addRawText(title, text);
      onImported(book);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled Notes"
        className="w-full rounded-xl border border-white/10 bg-surface px-4 py-3 text-base text-zinc-300 placeholder-zinc-600 outline-none"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste lecture notes, an article, anything you want to read distraction-free..."
        rows={8}
        className="w-full resize-y rounded-2xl border border-white/10 bg-surface p-4 text-base text-zinc-300 placeholder-zinc-600 outline-none"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving || text.trim().length === 0}
        className="self-start rounded-full bg-gradient-to-b from-blue-500 to-blue-600 ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(37,99,235,0.55)] px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:from-blue-400 hover:to-blue-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Adding..." : "Add to Library"}
      </button>
    </div>
  );
}
