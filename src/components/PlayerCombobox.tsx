"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Player } from "@/lib/supabase/types";

export type PlayerComboboxHandle = {
  focus: () => void;
  clear: () => void;
};

type Props = {
  value: string | null;
  selectedName: string | null;
  options: Player[];
  onSelect: (id: string) => void;
  onClear?: () => void;
  onEmptyEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  allowClear?: boolean;
  emptyHint?: string;
  className?: string;
};

export const PlayerCombobox = forwardRef<PlayerComboboxHandle, Props>(
  function PlayerCombobox(
    {
      value,
      selectedName,
      options,
      onSelect,
      onClear,
      onEmptyEnter,
      placeholder = "Skriv namn…",
      disabled = false,
      autoFocus = false,
      allowClear = false,
      emptyHint = "Ingen matchning",
      className = "",
    },
    ref
  ) {
    const [query, setQuery] = useState(selectedName ?? "");
    const [open, setOpen] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const fieldId = useId();

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        clear: () => {
          setQuery("");
          setOpen(false);
        },
      }),
      []
    );

    useEffect(() => {
      setQuery(selectedName ?? "");
    }, [selectedName]);

    useEffect(() => {
      if (!open) return;
      function handle(e: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setOpen(false);
          setQuery(selectedName ?? "");
        }
      }
      window.addEventListener("mousedown", handle);
      return () => window.removeEventListener("mousedown", handle);
    }, [open, selectedName]);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? options.filter((p) => p.name.toLowerCase().includes(q))
        : options;
      return matches.slice(0, 8);
    }, [query, options]);

    useEffect(() => {
      if (activeIdx >= filtered.length) setActiveIdx(0);
    }, [filtered, activeIdx]);

    function commit(p: Player) {
      // Set query first so onSelect handlers that call clear() via the ref
      // can win the batched update — otherwise this setQuery would overwrite
      // their reset.
      setQuery(p.name);
      setOpen(false);
      onSelect(p.id);
    }

    function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (open && filtered[activeIdx]) {
          e.preventDefault();
          commit(filtered[activeIdx]);
        } else if (!query.trim() && onEmptyEnter) {
          e.preventDefault();
          setOpen(false);
          onEmptyEnter();
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        setQuery(selectedName ?? "");
        inputRef.current?.blur();
      }
    }

    return (
      <div ref={containerRef} className={`relative ${className}`}>
        <input
          ref={inputRef}
          type="text"
          name={`pc-${fieldId}`}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          disabled={disabled}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          className="w-full px-2 py-1.5 pr-7 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100 text-sm disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-zinc-400"
        />
        {allowClear && value && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setQuery("");
              setOpen(false);
              onClear?.();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-base leading-none"
            aria-label="Rensa"
          >
            ×
          </button>
        )}
        {open && filtered.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md"
          >
            {filtered.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(p);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`px-2 py-1.5 text-sm cursor-pointer ${
                  i === activeIdx ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"
                }`}
              >
                {p.name}
              </li>
            ))}
          </ul>
        )}
        {open && query.trim() && filtered.length === 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {emptyHint}
          </div>
        )}
      </div>
    );
  }
);
