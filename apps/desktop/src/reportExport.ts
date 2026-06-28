const DEFAULT_MARKDOWN_FILENAME_PREFIX = "weekly-report";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function buildMarkdownFilename(
  updatedAt?: number | null,
  prefix = DEFAULT_MARKDOWN_FILENAME_PREFIX,
) {
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    const date = new Date(updatedAt);

    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getFullYear();
      const mm = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());

      return `${prefix}-${yyyy}-${mm}-${dd}.md`;
    }
  }

  return `${prefix}.md`;
}

export async function copyMarkdownToClipboard(markdown: string) {
  if (!markdown) {
    throw new Error("没有可复制的内容");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(markdown);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = markdown;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  const succeeded = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!succeeded) {
    throw new Error("浏览器不支持复制");
  }
}

export function downloadMarkdownFile(markdown: string, fileName: string) {
  if (!markdown) {
    throw new Error("没有可导出的内容");
  }

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
