"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Heading2,
} from "lucide-react";

// Rich text editor for the event description. Unlike the campaign
// RichText (which is inline-emphasis only), this enables the structure a
// schedule/agenda needs: sub-headings and bullet/numbered lists. The
// output HTML is sanitised server-side by sanitizeEventDescription before
// it ever renders on a storefront.

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
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

export function DescriptionEditor({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  // Wrap legacy plain-text drafts in a paragraph so they don't render as a
  // single un-paragraphed line.
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
          "min-h-[120px] focus:outline-none px-3 py-2 text-sm leading-relaxed " +
          "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
          "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
          "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5 " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "data-placeholder": placeholder ?? "Write…",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? "" : editor.getHTML());
    },
  });

  // Reflect external value changes (e.g. reset).
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
      <div className="rounded-md border bg-background min-h-[160px] animate-pulse" />
    );
  }

  return (
    <div className="rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  function toggleLink() {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = prompt("Link URL (https://…)");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      alert("Link must start with https:// or http://");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      <ToolButton
        active={editor.isActive("bold")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold (⌘B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic (⌘I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
      <ToolButton
        active={editor.isActive("heading", { level: 2 })}
        disabled={disabled}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        label="Heading"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("bulletList")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("orderedList")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="h-3.5 w-px bg-border mx-1" aria-hidden />
      <ToolButton
        active={editor.isActive("link")}
        disabled={disabled}
        onClick={toggleLink}
        label={editor.isActive("link") ? "Remove link" : "Add link"}
      >
        {editor.isActive("link") ? (
          <Link2Off className="h-3.5 w-3.5" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
      </ToolButton>
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
