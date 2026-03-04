"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { TextBlock as TextBlockType } from "@/lib/block-types";

export function TextBlock({ block }: { block: TextBlockType }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {block.text}
      </ReactMarkdown>
    </div>
  );
}
