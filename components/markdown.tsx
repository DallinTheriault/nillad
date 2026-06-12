"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders Nillad's replies as real Markdown (headings, lists, tables, code,
// links) instead of raw "###/**" text. Styled compact + dark for the mobile
// chat bubble. Used only for assistant messages. Components pull only the props
// they use, so react-markdown's `node` prop never leaks to the DOM.
type Kids = { children?: ReactNode };

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body text-[15px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: Kids) => <h1 className="text-[17px] font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
          h2: ({ children }: Kids) => <h2 className="text-[16px] font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }: Kids) => <h3 className="text-[15px] font-semibold mt-3 mb-1 first:mt-0">{children}</h3>,
          h4: ({ children }: Kids) => <h4 className="text-[15px] font-semibold mt-2 mb-1 first:mt-0">{children}</h4>,
          p: ({ children }: Kids) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }: Kids) => <ul className="my-2 ml-4 list-disc space-y-1 marker:text-bone-mute">{children}</ul>,
          ol: ({ children }: Kids) => <ol className="my-2 ml-4 list-decimal space-y-1 marker:text-bone-mute">{children}</ol>,
          li: ({ children }: Kids) => <li className="pl-0.5">{children}</li>,
          a: ({ href, children }: Kids & { href?: string }) => (
            <a
              href={href}
              className="text-periwinkle underline underline-offset-2 break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          strong: ({ children }: Kids) => <strong className="font-semibold text-bone">{children}</strong>,
          em: ({ children }: Kids) => <em className="italic">{children}</em>,
          blockquote: ({ children }: Kids) => (
            <blockquote className="my-2 pl-3 border-l-2 border-border text-bone-dim italic">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          code: ({ className, children }: Kids & { className?: string }) => {
            const isBlock = String(className || "").includes("language-");
            if (!isBlock) {
              return <code className="px-1 py-0.5 rounded bg-surface-2 text-[13px] font-mono text-bone">{children}</code>;
            }
            return <code className={`${className || ""} font-mono text-[13px]`}>{children}</code>;
          },
          pre: ({ children }: Kids) => (
            <pre className="my-2 p-3 rounded-lg bg-surface-2 border border-border overflow-x-auto text-[13px] leading-snug">
              {children}
            </pre>
          ),
          table: ({ children }: Kids) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[13px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }: Kids) => <thead className="bg-surface-2">{children}</thead>,
          th: ({ children }: Kids) => (
            <th className="text-left font-semibold px-2.5 py-1.5 border-b border-border whitespace-nowrap">{children}</th>
          ),
          td: ({ children }: Kids) => <td className="px-2.5 py-1.5 border-b border-border align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
