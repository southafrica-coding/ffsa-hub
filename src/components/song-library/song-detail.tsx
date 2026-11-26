"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { songLibraryApi, versionAudioUrl } from "./api";
import { NoAccessNote } from "./no-access";
import { errorCopy } from "./client";
import { describeEvent } from "./events";
import { duration, eventDay, initials, moverFor, shortDay } from "./format";
import { libraryPaths, type LibraryScope } from "./paths";
import { REFINE_BONUS_QUESTION, REFINE_QUESTIONS, refineProgress } from "./refine";
import { checkSplits } from "./splits";
import {
  canMovePlacement,
  CHECKPOINT_LABEL,
  ENTRY_LABEL,
  HELP_LABEL,
  nextStage,
  PLACEMENT_FLOW,
  PLACEMENT_LABEL,
  pathwaySteps,
  STAGE_LABEL,
  stageMoveOptions,
  stageNumber,
} from "./stages";
import { stuckInfo } from "./stuck";
import {
  REFINE_BONUS_Q_NO,
  SONG_CHECKPOINT_KINDS,
  SONG_HELP_CATEGORIES,
  SONG_STAGES,
  type SongDetail as SongDetailData,
  type SongHelpCategory,
  type SongPlacement,
  type SongStage,
} from "./types";

export function SongDetail({
  scope,
  songId,
  canManage,
  ownerName,
  initial,
}: {
  scope: LibraryScope;
  songId: string;
  /** Any member of the owning department: moves stage and placement. */
  canManage: boolean;
  /** Owning department's name, for "Any {name} member can move the stage." */
  ownerName: string | null;
  initial?: SongDetailData | null;
}) {
  const paths = libraryPaths(scope);
  const [detail, setDetail] = useState<SongDetailData | null>(initial ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (initial !== undefined) return;
    const controller = new AbortController();
    songLibraryApi.song(songId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setDetail(result.data);
      setDenied(result.denied);
      setLoading(false);
    });
    return () => controller.abort();
  }, [songId, initial]);

  if (loading) return <p className={pw.hint}>Loading the song…</p>;
  if (denied) return <NoAccessNote />;
  if (!detail) {
    return (
      <div className={pw.empty}>
        <div className={pw.emptyTitle}>Song not found</div>
        <p className={pw.emptyText}>It may have been removed, or the library isn&apos;t open yet.</p>
        <Link className={`${pw.btn} ${pw.block}`} href={paths.home} style={{ marginTop: 18 }}>
          Back to the library
        </Link>
      </div>
    );
  }
  return <SongBody detail={detail} setDetail={setDetail} canManage={canManage} ownerName={ownerName} scope={scope} />;
}

function SongBody({
  detail,
  setDetail,
  canManage,
  ownerName,
  scope,
}: {
  detail: SongDetailData;
  setDetail: (d: SongDetailData) => void;
  canManage: boolean;
  ownerName: string | null;
  scope: LibraryScope;
}) {
  const paths = libraryPaths(scope);
  const { song } = detail;
  const [now] = useState(() => new Date());
  const [versionId, setVersionId] = useState(song.current_version_id ?? detail.versions[detail.versions.length - 1]?.id ?? null);
  const [stageMenu, setStageMenu] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(detail.viewerFollowsLead);
  const [asking, setAsking] = useState(false);

  const canManageSong = detail.viewer?.canManage ?? canManage;
  const canTick = detail.viewer?.canTickRefine === true;
  const mover = moverFor(canManageSong, detail.viewerIsWriter);
  const moves = stageMoveOptions(mover, song.stage);
  const next = nextStage(song.stage);
  const n = stageNumber(song.stage);
  const info = stuckInfo(song.stage, song.last_activity_at, now, detail.status);
  const lead = detail.writers.find((w) => w.is_lead) ?? detail.writers[0];
  const splitCheck = checkSplits(detail.writers);
  const refine = refineProgress(detail.refine);
  const doneSteps = new Set(detail.pathwaySteps.map((s) => s.step));
  const demo = detail.versions.find((v) => v.is_demo);
  const memberWord = ownerName ? `Any ${ownerName} member` : "A team lead";

  async function refetchSong() {
    const result = await songLibraryApi.song(song.id);
    if (result.data) setDetail(result.data);
  }

  async function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; code: string | null }>, apply: (data: T) => void) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await action();
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      if (result.code === "song_moved") await refetchSong();
      setBusy(false);
      return;
    }
    setBusy(false);
    apply(result.data);
  }

  const moveStage = (to: SongStage) =>
    run(
      () => songLibraryApi.moveStage(song.id, to, song.stage),
      (data) => {
        setStageMenu(false);
        setDetail({ ...detail, song: data?.song ?? { ...song, stage: to, last_activity_at: new Date().toISOString() } });
      }
    );
  const movePlacement = (to: SongPlacement) =>
    run(
      () => songLibraryApi.movePlacement(song.id, to, song.placement),
      (data) => setDetail({ ...detail, song: data?.song ?? { ...song, placement: to, last_activity_at: new Date().toISOString() } })
    );
  const tick = (q: number, checked: boolean) =>
    run(
      () => songLibraryApi.tickRefine(song.id, q, checked),
      () => {
        const others = detail.refine.filter((r) => r.q_no !== q);
        const prev = detail.refine.find((r) => r.q_no === q);
        setDetail({
          ...detail,
          refine: [...others, { song_id: song.id, q_no: q, checked, note: prev?.note ?? null, by_user: null, at: new Date().toISOString() }],
        });
      }
    );
  const toggleFollow = () => {
    if (!lead?.user_id) return;
    const nextOn = !following;
    run(
      () => songLibraryApi.subscribeWriter(lead.user_id as string, nextOn),
      () => setFollowing(nextOn)
    );
  };

  const placementIndex = PLACEMENT_FLOW.indexOf(song.placement);
  const placementTo = (p: SongPlacement) => canMovePlacement(mover, song.placement, p);

  return (
    <>
      <section className={`${sl.player} theme-light`} aria-label="Player">
        {versionId ? (
          <audio key={versionId} controls preload="none" src={versionAudioUrl(versionId)} aria-label={`Play ${song.title}`} />
        ) : (
          <p className={sl.playerEmpty}>No audio yet</p>
        )}
        {detail.versions.length > 0 ? (
          <label className={sl.playerVersion}>
            <span className={pw.srOnly}>Version</span>
            <select value={versionId ?? ""} onChange={(e) => setVersionId(e.target.value)}>
              {[...detail.versions]
                .sort((a, b) => b.n - a.n)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.n}
                    {v.label ? ` · ${v.label}` : ""}
                    {v.is_demo ? " · demo" : ""}
                  </option>
                ))}
            </select>
            <span className={sl.playerCount}>
              {detail.versions.length} {detail.versions.length === 1 ? "VERSION" : "VERSIONS"}
            </span>
          </label>
        ) : null}
      </section>

      <div className={pw.pagehead} style={{ padding: "16px 20px 10px" }}>
        <div className={pw.eyebrow}>Song · added {shortDay(song.created_at)}</div>
        <h2 className={pw.title} style={{ fontSize: 30 }}>
          {song.title}
        </h2>
        <div className={sl.people}>
          {detail.writers.map((w) =>
            w.user_id ? (
              <Link key={w.id} className={pw.who} href={paths.writer(w.user_id)}>
                <span className={pw.avatar} aria-hidden="true">
                  {initials(w.name)}
                </span>
                {w.name}
              </Link>
            ) : (
              <span key={w.id} className={pw.who}>
                <span className={pw.avatar} aria-hidden="true">
                  {initials(w.name)}
                </span>
                {w.name}
                <span className={`${pw.small} ${pw.muted}`}>No Hub account</span>
              </span>
            )
          )}
        </div>
      </div>
      <div className={`${pw.pad} ${pw.btnrow} ${pw.ruled}`} style={{ paddingTop: 0 }}>
        {lead?.user_id && !detail.viewerIsWriter ? (
          <button type="button" className={`${pw.btn} ${pw.primary} ${pw.grow}`} onClick={toggleFollow} aria-pressed={following} disabled={busy}>
            <span aria-hidden="true">🔔</span> {following ? "Subscribed" : "Subscribe"}
          </button>
        ) : null}
        <button type="button" className={`${pw.btn} ${pw.grow}`} onClick={() => setAsking((v) => !v)} aria-expanded={asking}>
          Ask for help
        </button>
      </div>
      {asking ? <AskHelp songId={song.id} onDone={() => setAsking(false)} /> : null}
      {message ? (
        <p className={pw.status} role="alert">
          {message}
        </p>
      ) : null}

      <div className={sl.stagecard}>
        <div className={sl.stageHead}>
          <span className={pw.mono}>
            Stage {n} of {SONG_STAGES.length}
          </span>
          {moves.length ? (
            <button type="button" className={pw.btn} aria-expanded={stageMenu} onClick={() => setStageMenu((v) => !v)}>
              Move stage <span aria-hidden="true">▾</span>
            </button>
          ) : null}
        </div>
        <h3 className={sl.stageName}>{STAGE_LABEL[song.stage]}</h3>
        <div className={sl.segbar} role="img" aria-label={`Stage ${n} of ${SONG_STAGES.length}: ${STAGE_LABEL[song.stage]}`}>
          {SONG_STAGES.map((s, i) => (
            <span key={s} className={i < n - 1 ? sl.segDone : i === n - 1 ? sl.segNow : ""} />
          ))}
        </div>
        <div className={sl.seglbl} aria-hidden="true">
          <span>Idea</span>
          <span>Celebrate</span>
        </div>
        <p className={sl.stageText}>
          {song.stage === "writing"
            ? "Next: Set it down for about a day, or skip straight to Refine. "
            : song.stage === "set_down"
              ? "Set it down is a suggestion: come back with fresh ears, or move on to Refine whenever you're ready. "
              : next
                ? `Next: ${STAGE_LABEL[next]}. `
                : "This song has reached the end of the road. "}
          {memberWord} can move the stage.
          {info.stuck ? ` No change in ${info.days} days.` : ""}
        </p>
        {song.pathway ? (
          <div className={sl.pathway}>
            <span className={pw.mono} style={{ marginRight: 4 }}>
              Pathway
            </span>
            {[song.entry_point, ...pathwaySteps(song.entry_point, song.pathway)].map((step, i) => (
              <span key={step} style={{ display: "contents" }}>
                {i > 0 ? (
                  <span className={sl.arrow} aria-hidden="true">
                    →
                  </span>
                ) : null}
                <span className={`${sl.step} ${i === 0 || doneSteps.has(step) ? sl.stepDone : ""}`}>
                  {ENTRY_LABEL[step]}
                  {i === 0 || doneSteps.has(step) ? " ✓" : ""}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {stageMenu ? (
        <div className={sl.menu}>
          <ul aria-label="Move to stage">
            {moves.map((to) => (
              <li key={to}>
                <button type="button" onClick={() => moveStage(to)} disabled={busy}>
                  {STAGE_LABEL[to]}
                  {to === "set_down" ? " (optional)" : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Refine</h2>
        <span className={pw.sectionMeta}>
          {refine.done} of 10 · bonus {refine.bonus ? "done" : "open"}
        </span>
      </div>
      {[...REFINE_QUESTIONS.map((q, i) => ({ q_no: i + 1, text: q })), { q_no: REFINE_BONUS_Q_NO, text: REFINE_BONUS_QUESTION }].map((item) => {
        const row = detail.refine.find((r) => r.q_no === item.q_no);
        const checked = row?.checked ?? false;
        const bonus = item.q_no === REFINE_BONUS_Q_NO;
        return (
          <button
            key={item.q_no}
            type="button"
            role="checkbox"
            aria-checked={checked}
            disabled={!canTick || busy}
            className={`${sl.ck} ${bonus ? sl.bonus : ""}`}
            onClick={() => tick(item.q_no, !checked)}
          >
            <span className={pw.cbHit}>
              <span className={`${pw.cb} ${checked ? pw.cbOn : ""}`} />
            </span>
            <span className={sl.ckQ}>
              {bonus ? null : <span className={sl.ckN}>{item.q_no}.</span>}
              {item.text}
              {row?.note ? <span className={sl.ckA}>{row.note}</span> : null}
              {bonus ? <span className={sl.ckA}>Bonus question · not required to move on</span> : null}
            </span>
          </button>
        );
      })}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Placement</h2>
        <span className={pw.sectionMeta}>{canManageSong ? `any ${ownerName ?? "team"} member` : "set by the team"}</span>
      </div>
      <div className={sl.placeflow} role="group" aria-label="Placement">
        {PLACEMENT_FLOW.map((p, i) => {
          const cls = p === song.placement ? sl.pNow : placementIndex >= 0 && i < placementIndex ? sl.pDone : "";
          return (
            <span key={p} style={{ display: "contents" }}>
              {i > 0 ? (
                <span className={sl.arrow} aria-hidden="true">
                  →
                </span>
              ) : null}
              <PlacementChip label={PLACEMENT_LABEL[p]} className={cls} current={p === song.placement} enabled={placementTo(p) && !busy} onClick={() => movePlacement(p)} />
            </span>
          );
        })}
        <PlacementChip
          label={`or ${PLACEMENT_LABEL.personal}`}
          className={`${sl.pSide} ${song.placement === "personal" ? sl.pNow : ""}`}
          current={song.placement === "personal"}
          enabled={placementTo("personal") && !busy}
          onClick={() => movePlacement("personal")}
        />
      </div>
      {SONG_CHECKPOINT_KINDS.map((kind) => {
        const cp = detail.checkpoints.find((c) => c.kind === kind);
        const done = !!cp?.done_at;
        const blocked = kind === "credits_splits_agreed" && !done && !splitCheck.ok;
        return (
          <div key={kind} className={sl.cp}>
            <span className={`${pw.cb} ${done ? pw.cbOn : ""}`} role="img" aria-label={done ? "Done" : "Not yet"} />
            <div className={pw.what} style={{ fontSize: 14.5 }}>
              {CHECKPOINT_LABEL[kind]}
              {blocked ? (
                <span className={sl.cpS}>Blocked: splits total {splitCheck.totalPct}%</span>
              ) : cp?.note || cp?.done_at ? (
                <span className={sl.cpS}>{[cp?.note, cp?.done_at ? eventDay(cp.done_at) : null].filter(Boolean).join(" · ")}</span>
              ) : null}
            </div>
            {blocked ? <span className={`${pw.pill} ${pw.pillRed}`}>Blocked</span> : null}
          </div>
        );
      })}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Where it&apos;s been</h2>
        <span className={pw.sectionMeta}>
          {detail.events.length} {detail.events.length === 1 ? "move" : "moves"}
        </span>
      </div>
      {detail.events.length ? (
        <ol className={sl.tl}>
          {[...detail.events]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((ev, i) => {
              const line = describeEvent(ev);
              return (
                <li key={ev.id} className={`${sl.ev} ${i === 0 ? sl.evNow : ""}`}>
                  <div className={sl.evWhen}>{eventDay(ev.at)}</div>
                  <div className={sl.evK}>{i === 0 ? <b>{line.title}</b> : line.title}</div>
                  {line.via ? <div className={sl.evVia}>{line.via}</div> : null}
                </li>
              );
            })}
        </ol>
      ) : (
        <p className={pw.hint}>Nothing yet.</p>
      )}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Audio versions</h2>
        <span className={pw.sectionMeta}>first mp3 → demo</span>
      </div>
      {[...detail.versions]
        .sort((a, b) => b.n - a.n)
        .map((v) => (
          <button key={v.id} type="button" className={`${sl.ver} ${v.id === versionId ? sl.verCur : ""}`} style={{ width: "100%", textAlign: "left" }} onClick={() => setVersionId(v.id)} aria-pressed={v.id === versionId}>
            <span className={sl.verPlay} aria-hidden="true">
              ▶
            </span>
            <span className={pw.what}>
              <span className={pw.k} style={{ display: "block", fontSize: 14.5 }}>
                v{v.n}
                {v.label ? ` · ${v.label}` : ""}
              </span>
              <span className={pw.s} style={{ display: "block", color: "var(--text-tertiary)", fontSize: 12.5 }}>
                {[v.is_demo ? "Demo" : null, duration(v.duration_s), shortDay(v.uploaded_at)].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        ))}
      {demo ? null : (
        <div className={sl.ver} style={{ opacity: 0.75 }}>
          <span className={`${sl.verPlay} ${sl.verPlayDash}`} aria-hidden="true">
            +
          </span>
          <div className={pw.what}>
            <div className={pw.k} style={{ fontSize: 14.5 }}>
              Demo
            </div>
            <div className={pw.s} style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>
              Not yet · comes at “Demo ready”
            </div>
          </div>
        </div>
      )}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Lyrics &amp; chart</h2>
        <span className={pw.sectionMeta}>
          {[song.music_key ? `key of ${song.music_key}` : null, song.bpm ? `${song.bpm} bpm` : null].filter(Boolean).join(" · ") || "not added"}
        </span>
      </div>
      {song.lyrics_md ? <pre className={sl.lyrics}>{song.lyrics_md}</pre> : <p className={pw.hint}>No lyrics yet.</p>}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Writers &amp; splits</h2>
        <span className={pw.sectionMeta}>must total 100%</span>
      </div>
      {detail.writers.map((w) => (
        <div key={w.id} className={sl.split}>
          <span className={pw.avatar} aria-hidden="true">
            {initials(w.name)}
          </span>
          <div className={pw.what}>
            <div className={pw.k}>{w.name}</div>
            <div className={pw.s} style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>
              {[w.role, w.is_lead ? "lead" : null, w.confirmed_at ? "confirmed" : null].filter(Boolean).join(" · ") || "Writer"}
            </div>
          </div>
          <span className={sl.pct}>{w.split_pct == null ? "—" : `${w.split_pct}%`}</span>
        </div>
      ))}
      {detail.writers.length ? (
        <div className={sl.sbar} aria-hidden="true">
          {detail.writers.map((w, i) => (
            <span
              key={w.id}
              style={{
                width: `${Math.max(0, Math.min(100, w.split_pct ?? 0))}%`,
                background: ["var(--ink)", "var(--text-tertiary)", "var(--rule-strong)"][i % 3],
              }}
            />
          ))}
        </div>
      ) : null}
      <div className={`${sl.splittotal} ${splitCheck.ok ? "" : sl.splittotalBad}`}>
        <div>
          <div className={pw.mono}>Total</div>
          {splitCheck.ok ? null : (
            <p className={pw.error} style={{ marginTop: 4 }}>
              {splitCheck.message}
            </p>
          )}
        </div>
        <span className={sl.splitV}>{splitCheck.totalPct}%</span>
      </div>

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Publishing</h2>
        <span className={pw.sectionMeta}>fill when released</span>
      </div>
      <dl className={sl.facts}>
        <div className={sl.fact}>
          <dt>CCLI #</dt>
          <dd className={detail.publishing?.ccli_no ? "" : pw.quiet}>{detail.publishing?.ccli_no ?? "Not registered"}</dd>
        </div>
        <div className={sl.fact}>
          <dt>ISRC</dt>
          <dd className={pw.quiet}>{detail.versions.find((v) => v.isrc)?.isrc ?? "Comes with a recording"}</dd>
        </div>
        <div className={sl.fact}>
          <dt>Publisher</dt>
          <dd className={detail.publishing?.publisher ? "" : pw.quiet}>{detail.publishing?.publisher ?? "Not set"}</dd>
        </div>
      </dl>

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Help requests</h2>
        <span className={pw.sectionMeta}>{detail.helpRequests.filter((h) => h.status === "open").length} open</span>
      </div>
      {detail.helpRequests.length === 0 ? <p className={pw.hint}>No help asked for yet.</p> : null}
      {detail.helpRequests.map((h) => (
        <div key={h.id} className={sl.help}>
          <div className={sl.helpTop}>
            <div className={pw.what}>
              <div className={pw.k}>{h.body}</div>
              <div className={pw.s}>
                {h.status === "open"
                  ? `Asked by ${h.askedByName ?? "a writer"} · ${shortDay(h.created_at)}`
                  : `${h.helperName ? `${h.helperName} helped` : "Closed"} · ${shortDay(h.closed_at ?? h.updated_at)}`}
              </div>
            </div>
            <span className={`${pw.pill} ${h.status === "open" ? pw.pillAmber : pw.pillGreen}`}>{h.status === "open" ? "Open" : "Done"}</span>
          </div>
          <div className={sl.meta}>
            {h.categories.map((c) => (
              <span key={c} className={pw.chip}>
                {HELP_LABEL[c]}
              </span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function PlacementChip({
  label,
  className,
  current,
  enabled,
  onClick,
}: {
  label: string;
  className: string;
  current: boolean;
  enabled: boolean;
  onClick: () => void;
}) {
  if (!enabled) {
    return (
      <span className={`${sl.p} ${className}`} aria-current={current ? "true" : undefined}>
        {label}
      </span>
    );
  }
  return (
    <button type="button" className={`${sl.p} ${className}`} onClick={onClick} aria-label={`Move placement to ${label}`}>
      {label}
    </button>
  );
}

function AskHelp({ songId, onDone }: { songId: string; onDone: () => void }) {
  const [cats, setCats] = useState<SongHelpCategory[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function send() {
    if (busy || !cats.length || !body.trim()) return;
    setBusy(true);
    const result = await songLibraryApi.askHelp(songId, cats, body.trim());
    setBusy(false);
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      return;
    }
    onDone();
  }
  return (
    <div className={pw.field} style={{ background: "var(--surface-2)" }}>
      <span className={pw.label}>What do you need?</span>
      <div className={pw.chips} role="group" aria-label="Help categories">
        {SONG_HELP_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${pw.chipBtn} ${cats.includes(c) ? pw.chipBtnOn : ""}`}
            aria-pressed={cats.includes(c)}
            onClick={() => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
          >
            {HELP_LABEL[c]}
          </button>
        ))}
      </div>
      <label className={pw.label} htmlFor={`ask-${songId}`} style={{ marginTop: 12 }}>
        Say a little more
      </label>
      <textarea id={`ask-${songId}`} className={pw.input} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Bass and drums for the demo" />
      <p className={`${pw.small} ${pw.muted}`} style={{ marginTop: 6 }}>
        Helpers signed up for these get a Slack DM.
      </p>
      {message ? (
        <p className={pw.error} role="alert">
          {message}
        </p>
      ) : null}
      <div className={pw.btnrow} style={{ marginTop: 10 }}>
        <button type="button" className={`${pw.btn} ${pw.grow}`} onClick={onDone}>
          Cancel
        </button>
        <button type="button" className={`${pw.btn} ${pw.primary} ${pw.grow}`} onClick={send} disabled={busy || !cats.length || !body.trim()}>
          Ask for help
        </button>
      </div>
    </div>
  );
}
