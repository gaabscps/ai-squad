import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Peça única de renderização de markdown no app. Sem rehype-raw de propósito:
// react-markdown NÃO injeta HTML cru por padrão, então conteúdo entre tags é
// escapado (seguro). O estilo de cada elemento vem do CSS escopado em .md-body.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `md-body ${className}` : "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
