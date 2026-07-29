"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link2,
  Link2Off,
  Sparkles,
  User,
  MoveVertical,
  RotateCcw,
} from "lucide-react";

// Minimal rich text editor for campaign text blocks. The editorial
// rendering pipeline accepts only the marks below — anything else gets
// stripped by the sanitizer in src/lib/campaigns/blocks.ts.

// Paragraph node that carries optional per-paragraph spacing:
//   • lineHeight   — unitless leading for the lines inside this paragraph
//   • marginBottom — px gap after this paragraph
// Both are stored as inline styles so they survive the HTML sanitizer
// (which whitelists line-height + margin-bottom on <p>) and are merged
// with the block/email defaults at render time (see blocks.ts).
const SpacedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      lineHeight: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).style.lineHeight || null,
        renderHTML: (attrs) =>
          attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {},
      },
      marginBottom: {
        default: null as number | null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).style.marginBottom;
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.marginBottom != null
            ? { style: `margin-bottom:${attrs.marginBottom}px` }
            : {},
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Pressing Enter should always add a normally-spaced paragraph.
      // ProseMirror copies node attributes across a split, so without this
      // a custom "gap after" would stick to every new paragraph (and, since
      // the rendered email only uses bottom margins, collapse the gap).
      // We clear the current paragraph's gap before splitting so both the
      // paragraph left behind and the new one fall back to the default gap.
      Enter: () =>
        this.editor
          .chain()
          .command(({ tr, state, dispatch }) => {
            const { $from } = state.selection;
            const pos = $from.before($from.depth);
            const node = state.doc.nodeAt(pos);
            if (
              node?.type.name === this.name &&
              node.attrs.marginBottom != null
            ) {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  marginBottom: null,
                });
              }
            }
            return true;
          })
          .splitBlock()
          .run(),
    };
  },
});

const EXTENSIONS = [
  StarterKit.configure({
    // Keep the editor focused on inline emphasis + line structure.
    // Paragraph is replaced by SpacedParagraph below; bold/italic/
    // underline/strike marks stay on. Link is replaced by the custom
    // configuration below.
    paragraph: false,
    link: false,
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
  }),
  SpacedParagraph,
  Link.configure({
    openOnClick: false,
    autolink: true,
    HTMLAttributes: { rel: "noopener", target: "_blank" },
  }),
];

export function RichText({
  value,
  onChange,
  disabled,
  placeholder,
  onPolish,
  mergeFields,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Optional one-click insert buttons for merge tokens, e.g. [First Name]. */
  mergeFields?: Array<{ label: string; token: string }>;
  /**
   * Optional AI polish hook. When provided, a ✨ button appears in the
   * toolbar; clicking it sends the current HTML to onPolish and replaces
   * the editor content with the returned HTML.
   */
  onPolish?: (html: string) => Promise<string>;
}) {
  // If value looks like plain text (no tags), wrap it in a paragraph
  // so Tiptap doesn't render it as a single un-paragraphed line.
  const initialContent = /<[a-z]/i.test(value)
    ? value
    : value
      ? `<p>${value.replace(/\n/g, "<br/>")}</p>`
      : "";

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initialContent,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[80px] focus:outline-none px-3 py-2 text-sm leading-relaxed [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "data-placeholder": placeholder ?? "Write…",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      onChange(html);
    },
  });

  // Reflect external value changes (e.g. when switching campaigns).
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current === value) return;
    if (initialContent !== current) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className="rounded border bg-background min-h-[120px] animate-pulse" />
    );
  }

  return (
    <div className="rounded border bg-background">
      <Toolbar
        editor={editor}
        disabled={disabled}
        onPolish={onPolish}
        mergeFields={mergeFields}
      />
      <EditorContent editor={editor} />
      <p className="border-t bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground rounded-b-[3px]">
        <kbd className="font-sans font-medium">Enter</kbd> = new paragraph ·{" "}
        <kbd className="font-sans font-medium">Shift+Enter</kbd> = line break ·{" "}
        <MoveVertical className="inline h-3 w-3 -mt-0.5" aria-hidden /> = spacing
        for this paragraph
      </p>
    </div>
  );
}

function Toolbar({
  editor,
  disabled,
  onPolish,
  mergeFields,
}: {
  editor: Editor;
  disabled?: boolean;
  onPolish?: (html: string) => Promise<string>;
  mergeFields?: Array<{ label: string; token: string }>;
}) {
  const [polishing, setPolishing] = useState(false);
  const isBold = editor.isActive("bold");
  const isItalic = editor.isActive("italic");
  const isUnderline = editor.isActive("underline");
  const isStrike = editor.isActive("strike");
  const isLink = editor.isActive("link");

  function toggleBold() {
    editor.chain().focus().toggleBold().run();
  }
  function toggleItalic() {
    editor.chain().focus().toggleItalic().run();
  }
  function toggleUnderline() {
    editor.chain().focus().toggleUnderline().run();
  }
  function toggleStrike() {
    editor.chain().focus().toggleStrike().run();
  }
  function toggleLink() {
    if (isLink) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = prompt("Link URL (https://…)");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      alert("Link must start with https:// or http://");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }

  async function polishNow() {
    if (!onPolish) return;
    const html = editor.isEmpty ? "" : editor.getHTML();
    if (!html.trim()) return;
    setPolishing(true);
    try {
      const polished = await onPolish(html);
      if (polished && polished !== html) {
        editor.commands.setContent(polished, { emitUpdate: true });
      }
    } finally {
      setPolishing(false);
    }
  }

  return (
    <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1 rounded-t-[3px]">
      <ToolButton
        active={isBold}
        disabled={disabled}
        onClick={toggleBold}
        label="Bold (⌘B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={isItalic}
        disabled={disabled}
        onClick={toggleItalic}
        label="Italic (⌘I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={isUnderline}
        disabled={disabled}
        onClick={toggleUnderline}
        label="Underline (⌘U)"
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={isStrike}
        disabled={disabled}
        onClick={toggleStrike}
        label="Strikethrough"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={isLink}
        disabled={disabled}
        onClick={toggleLink}
        label={isLink ? "Remove link" : "Add link"}
      >
        {isLink ? (
          <Link2Off className="h-3.5 w-3.5" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
      </ToolButton>
      <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
      <SpacingControl editor={editor} disabled={disabled} />
      {onPolish && (
        <>
          <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
          <ToolButton
            disabled={disabled || polishing}
            onClick={polishNow}
            label={polishing ? "Polishing…" : "Polish copy with AI"}
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${polishing ? "animate-pulse text-amber-400" : ""}`}
            />
          </ToolButton>
        </>
      )}
      {mergeFields && mergeFields.length > 0 && (
        <>
          <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
          {mergeFields.map((f) => (
            <button
              key={f.token}
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().insertContent(f.token).run()}
              title={`Insert ${f.label} — automatically replaced with the recipient's name when the email sends`}
              className="inline-flex items-center gap-1 h-6 rounded px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <User className="h-3 w-3" />
              {f.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// Per-paragraph spacing popover. Acts on the paragraph containing the
// cursor: leading (line-height) + the gap after it (margin-bottom).
// Empty inputs clear the override and fall back to the block/email default.
function SpacingControl({
  editor,
  disabled,
}: {
  editor: Editor;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const attrs = editor.getAttributes("paragraph") as {
    lineHeight?: string | null;
    marginBottom?: number | null;
  };
  const inParagraph = editor.isActive("paragraph");
  const hasOverride =
    attrs.lineHeight != null || attrs.marginBottom != null;

  function setLineHeight(v: string) {
    const val = v.trim();
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", { lineHeight: val === "" ? null : val })
      .run();
  }
  function setMargin(v: string) {
    const val = v.trim();
    const n = val === "" ? null : parseInt(val, 10);
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", {
        marginBottom: n != null && Number.isFinite(n) ? n : null,
      })
      .run();
  }
  function reset() {
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", { lineHeight: null, marginBottom: null })
      .run();
  }

  return (
    <div className="relative" ref={wrapRef}>
      <ToolButton
        active={hasOverride}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        label="Spacing for this paragraph"
      >
        <MoveVertical className="h-3.5 w-3.5" />
      </ToolButton>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-popover p-3 shadow-md">
          {!inParagraph ? (
            <p className="text-[11px] text-muted-foreground">
              Click into a paragraph to set its spacing.
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                This paragraph
              </p>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Line height</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.8"
                  max="3"
                  value={attrs.lineHeight ?? ""}
                  placeholder="auto"
                  onChange={(e) => setLineHeight(e.target.value)}
                  className="w-20 rounded border bg-background px-2 py-1 text-xs"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Gap after (px)</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="120"
                  value={attrs.marginBottom ?? ""}
                  placeholder="auto"
                  onChange={(e) => setMargin(e.target.value)}
                  className="w-20 rounded border bg-background px-2 py-1 text-xs"
                />
              </label>
              <button
                type="button"
                onClick={reset}
                disabled={!hasOverride}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to email default
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-background disabled:opacity-30 disabled:hover:bg-transparent ${
        active ? "bg-background text-foreground" : ""
      }`}
    >
      {children}
    </button>
  );
}
