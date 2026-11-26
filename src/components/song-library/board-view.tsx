"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PlayIcon } from "@/components/departments/songwriting/icons";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { songLibraryApi } from "./api";
import { errorCopy } from "./client";
import { libraryPaths, type LibraryScope } from "./paths";
import { canMovePlacement, PLACEMENT_LABEL, STAGE_LABEL, stageMoveOptions } from "./stages";
import { DEFAULT_STUCK_AFTER, sortForBoard, stageCounts, stagesWithStuck, stuckInfo } from "./stuck";
import { SONG_PLACEMENTS, SONG_STAGES, type SongListItem, type SongPlacement, type SongStage } from "./types";

type Row = SongListItem & { stage: SongStage; stuck: boolean; days: number };

/** The lead board. Only members of the owning department reach this page. */
export function BoardView({ scope, ownerName, initial }: { scope: LibraryScope; ownerName: string | null; initial?: SongListItem[] }) {
  const paths = libraryPaths(scope);
  const [items, setItems] = useState<SongListItem[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [stage, setStage] = useState<SongStage | null>(null);
  const [order, setOrder] = useState<"stuck" | "recent">("stuck");
  const [placement, setPlacement] = useState<SongPlacement | "all">("all");
  const [open, setOpen] = useState<{ id: string; kind: "stage" | "placement" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    songLibraryApi.board(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setItems(result.data);
      setLoading(false);
    });
    return () => controller.abort();
  }, [initial]);

  const rows: Row[] = useMemo(
    () =>
      items.map((item) => {
        const info = stuckInfo(item.song.stage, item.song.last_activity_at, now, item.status);
        return { ...item, stage: item.song.stage, stuck: info.stuck, days: info.days };
      }),
    [items, now]
  );
  const counts = stageCounts(rows);
  const stuckStages = stagesWithStuck(rows);
  const active = stage ?? SONG_STAGES.find((s) => stuckStages.has(s)) ?? SONG_STAGES.find((s) => counts[s] > 0) ?? "idea_entry";
  const inStage = rows.filter((r) => r.stage === active && (placement === "all" || r.song.placement === placement));
  const list = order === "stuck" ? sortForBoard(inStage) : [...inStage].sort((a, b) => a.days - b.days);
  const stuckHere = inStage.filter((r) => r.stuck).length;

  async function move(row: Row, kind: "stage" | "placement", to: string) {
    setMessage(null);
    const result =
      kind === "stage" ? await songLibraryApi.moveStage(row.song.id, to as SongStage) : await songLibraryApi.movePlacement(row.song.id, to as SongPlacement);
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      return;
    }
    const stamp = new Date().toISOString();
    setItems((cur) =>
      cur.map((i) =>
        i.song.id === row.song.id
          ? { ...i, status: null, song: { ...i.song, ...(kind === "stage" ? { stage: to as SongStage } : { placement: to as SongPlacement }), last_activity_at: stamp } }
          : i
      )
    );
    setOpen(null);
  }

  return (
    <div aria-busy={loading || undefined}>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>Lead board</h2>
        <span className={pw.sectionMeta}>
          {ownerName ? `${ownerName} only` : "team only"} · {rows.length} {rows.length === 1 ? "song" : "songs"}
        </span>
      </div>
      <div className={sl.stagesw} role="group" aria-label="Stages">
        {SONG_STAGES.map((s) => (
          <button key={s} type="button" aria-pressed={s === active} onClick={() => setStage(s)} aria-label={`${STAGE_LABEL[s]}: ${counts[s]} songs${stuckStages.has(s) ? ", some stuck" : ""}`}>
            <span className={sl.swN}>{counts[s]}</span>
            <span className={sl.swL}>{STAGE_LABEL[s]}</span>
            {stuckStages.has(s) ? <span className={sl.dot} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className={sl.selectrow} style={{ paddingTop: 12 }}>
        <label className={sl.select}>
          <span className={sl.selectLabel}>Show</span>
          <select value={order} onChange={(e) => setOrder(e.target.value as "stuck" | "recent")}>
            <option value="stuck">Stuck first</option>
            <option value="recent">Recent first</option>
          </select>
        </label>
        <label className={sl.select}>
          <span className={sl.selectLabel}>Placement</span>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as SongPlacement | "all")}>
            <option value="all">All</option>
            {SONG_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {PLACEMENT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={sl.boardHead}>
        <h3 className={sl.boardTitle}>{STAGE_LABEL[active]}</h3>
        <span className={pw.mono}>
          {inStage.length} · {stuckHere} stuck
        </span>
      </div>
      {message ? (
        <p className={pw.status} role="alert" style={{ marginTop: 10 }}>
          {message}
        </p>
      ) : null}
      {list.length === 0 ? <p className={pw.hint} style={{ marginTop: 10 }}>{loading ? "Loading…" : "No songs in this stage."}</p> : null}
      {list.map((row) => (
        <div key={row.song.id} className={`${sl.bcard} ${row.stuck ? sl.bcardStuck : ""}`}>
          <Link className={sl.bcardTop} href={paths.song(row.song.id)}>
            <span className={sl.play} aria-hidden="true">
              <PlayIcon />
            </span>
            <div className={pw.what}>
              <div className={pw.k}>{row.song.title}</div>
              <div className={pw.s}>{row.writers.map((w) => w.name).join(", ")}</div>
            </div>
          </Link>
          <div className={sl.bcardMeta}>
            <span className={sl.place}>{PLACEMENT_LABEL[row.song.placement]}</span>
            {row.stuck ? <span className={sl.stuck}>Stuck · {row.days}d</span> : null}
            <span className={sl.when} style={{ marginTop: 0 }}>
              {row.stuck ? `No move ${row.days}d` : `Moved ${row.days}d ago`}
            </span>
            {row.status?.splits_agreed ? <span className={`${pw.pill} ${pw.pillGreen}`}>Splits ✓</span> : null}
          </div>
          <div className={sl.acts}>
            <button type="button" aria-expanded={open?.id === row.song.id && open.kind === "stage"} onClick={() => setOpen({ id: row.song.id, kind: "stage" })}>
              Stage ▸
            </button>
            <button type="button" aria-expanded={open?.id === row.song.id && open.kind === "placement"} onClick={() => setOpen({ id: row.song.id, kind: "placement" })}>
              Placement ▸
            </button>
          </div>
          {open?.id === row.song.id ? (
            <div className={sl.bcardMenu}>
              <label className={sl.select}>
                <span className={sl.selectLabel}>{open.kind === "stage" ? "Move to" : "Place in"}</span>
                <select defaultValue="" onChange={(e) => e.target.value && move(row, open.kind, e.target.value)}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {open.kind === "stage"
                    ? stageMoveOptions("manager", row.stage).map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))
                    : SONG_PLACEMENTS.filter((p) => canMovePlacement("manager", row.song.placement, p)).map((p) => (
                        <option key={p} value={p}>
                          {PLACEMENT_LABEL[p]}
                        </option>
                      ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ))}
      <p className={pw.hint} style={{ marginTop: 14, borderTop: "1px solid var(--rule)" }}>
        <b>Stuck</b> means no stage, version, placement, checkpoint, pathway or refine change in {DEFAULT_STUCK_AFTER.idea_entry} days. Set it down allows{" "}
        {DEFAULT_STUCK_AFTER.set_down} days. Celebrate is never stuck.
      </p>
    </div>
  );
}
