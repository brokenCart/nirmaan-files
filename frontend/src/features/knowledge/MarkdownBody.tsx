import ReactMarkdown from 'react-markdown'

import { cn } from '@/lib/utils'

/**
 * Project-authored Markdown with deliberately quiet, readable typography.
 *
 * `react-markdown` builds React elements rather than injecting HTML, so text
 * pasted into a shared page cannot smuggle markup or scripts into the app.
 */
export function MarkdownBody({ body, className }: { body: string; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-4 text-[1.0625rem] leading-[1.7] text-ink-soft [&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-200 [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-paper-deep [&_code]:px-1 [&_code]:py-0.5 [&_h1]:pt-3 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:pt-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:pt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-ink [&_hr]:border-line [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-paper-deep [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-6',
        className,
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
