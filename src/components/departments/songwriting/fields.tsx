"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import pw from "@/components/song-library/pw.module.css";

/** A list of short text values as removable chips, with an add row (trainers, languages). */
export function ChipListField({
  label,
  values,
  onChange,
  addLabel,
  placeholder,
  error,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  placeholder: string;
  error?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (!values.some((v) => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setText("");
  };
  return (
    <div className={pw.field}>
      <span className={pw.label} id={`${id}-label`}>
        {label}
      </span>
      {values.length ? (
        <ul className={pw.chips} aria-labelledby={`${id}-label`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {values.map((v) => (
            <li key={v}>
              <button
                type="button"
                className={`${pw.chipBtn} ${pw.chipBtnOn}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
              >
                {v} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={pw.addRow}>
        <input
          className={pw.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={addLabel}
        />
        <button type="button" className={pw.btn} onClick={add}>
          + Add
        </button>
      </div>
      {error}
    </div>
  );
}

/** "Not found" for an edit or detail screen whose record is gone. */
export function NotFoundNote({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return (
    <div className={pw.empty}>
      <div className={pw.emptyTitle}>{title}</div>
      <p className={pw.emptyText}>It may have been deleted.</p>
      <Link className={`${pw.btn} ${pw.block}`} href={backHref} style={{ marginTop: 18 }}>
        {backLabel}
      </Link>
    </div>
  );
}

/** Shown instead of an edit form when the viewer may not change the record. */
export function CannotEditNote({ text, backHref, backLabel }: { text: string; backHref: string; backLabel: string }) {
  return (
    <div className={pw.empty}>
      <div className={pw.emptyTitle}>You can&apos;t change this</div>
      <p className={pw.emptyText}>{text}</p>
      <Link className={`${pw.btn} ${pw.block}`} href={backHref} style={{ marginTop: 18 }}>
        {backLabel}
      </Link>
    </div>
  );
}
