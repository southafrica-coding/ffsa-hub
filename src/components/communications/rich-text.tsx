"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Bold, Italic, Link2, Link2Off, Sparkles, User } from "lucide-react";

// Minimal rich text editor for campaign text blocks. The editorial
// rendering pipeline accepts only the marks below — anything else gets
// stripped by the sanitizer in src/lib/campaigns/blocks.ts.

const EXTENSIONS = [
  StarterKit.configure({
    // Keep the editor focused on inline emphasis + line structure.
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
  }),
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
    <div className="rounded border bg-background overflow-hidden">
      <Toolbar
        editor={editor}
        disabled={disabled}
        onPolish={onPolish}
        mergeFields={mergeFields}
      />
      <EditorContent editor={editor} />
      <p className="border-t bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground">
        <kbd className="font-sans font-medium">Enter</kbd> = new paragraph ·{" "}
        <kbd className="font-sans font-medium">Shift+Enter</kbd> = line break
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
  const isLink = editor.isActive("link");

  function toggleBold() {
    editor.chain().focus().toggleBold().run();
  }
  function toggleItalic() {
    editor.chain().focus().toggleItalic().run();
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
    <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
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
      {onPolish && (
        <>
          <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
          <ToolButton
            disabled={disabled || polishing}
            onClick={polishNow}
            label={
              polishing ? "Polishing…" : "Polish copy with AI"
            }
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
