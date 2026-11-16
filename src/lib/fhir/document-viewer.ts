/**
 * Document attachment loading and mime-based view classification.
 *
 * Follows the metadata-first policy: attachments are only loaded here, on
 * explicit user selection. Attachments come either inline (base64 `data` on
 * the attachment) or by URL — typically a FHIR Binary reference, which is
 * fetched and unwrapped. Rendering is delegated to the browser per mime
 * type (text, html sandboxed, pdf, image) with a download fallback.
 */

import type { FhirResource } from "../smart/data";

export interface DocumentAttachment {
  url?: string;
  /** Inline base64 content. */
  data?: string;
  contentType?: string;
  title?: string;
  size?: number;
}

interface AttachmentLike {
  url?: string;
  data?: string;
  contentType?: string;
  title?: string;
  size?: number;
}

/** First usable attachment of a DocumentReference's content elements. */
export function documentAttachment(resource: FhirResource): DocumentAttachment | null {
  const content = Array.isArray(resource.content) ? (resource.content as Array<Record<string, unknown>>) : [];
  for (const entry of content) {
    const attachment = entry?.attachment as AttachmentLike | undefined;
    if (!attachment) continue;
    if (attachment.data || attachment.url) {
      return {
        url: attachment.url,
        data: attachment.data,
        contentType: attachment.contentType,
        title: attachment.title,
        size: attachment.size
      };
    }
  }
  return null;
}

export function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}

/** File extension for a mime type ("plain" → txt), for download filenames. */
export function mimeExtension(mimeType: string | undefined): string {
  const subtype = (mimeType || "application/octet-stream").split("/")[1] || "bin";
  return subtype === "plain" ? "txt" : subtype.replace(/[^a-z0-9]/gi, "");
}

/** Download filename: appends the extension unless the title already has it. */
export function downloadFilename(title: string, mimeType: string | undefined): string {
  const extension = mimeExtension(mimeType);
  if (title.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return title;
  return `${title}.${extension}`;
}

export type DocumentViewKind = "text" | "markdown" | "html" | "pdf" | "image" | "download";

export function viewKindFor(mimeType: string | undefined): DocumentViewKind {
  const type = (mimeType || "").toLowerCase();
  if (type === "text/markdown" || type === "text/x-markdown") return "markdown";
  if (type.startsWith("text/")) return type === "text/html" ? "html" : "text";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  return "download";
}

/**
 * Sniff markdown in text/plain attachments (Synthea-style notes carry real
 * markdown with a plain content type). Requires a heading or several list
 * lines so plain prose with a stray dash doesn't trigger it.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let headings = 0;
  let listLines = 0;
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) headings += 1;
    if (/^\s*[-*]\s+\S/.test(line)) listLines += 1;
  }
  return headings >= 1 || listLines >= 3;
}

/**
 * Effective view kind for a loaded attachment: honors declared mime types
 * and sniffs markdown in text/plain content.
 */
export function viewKindForContent(mimeType: string | undefined, text: string | undefined): DocumentViewKind {
  const declared = viewKindFor(mimeType);
  if (declared === "text" && text !== undefined && looksLikeMarkdown(text)) return "markdown";
  return declared;
}

/**
 * Resolve an attachment URL. Real feeds use relative references
 * ("Binary/123") that must resolve against the FHIR server base — fetching
 * them against the app origin silently hits the SPA fallback (an HTML 200).
 */
export function resolveAttachmentUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) {
    throw new Error("Attachment URL is relative and no FHIR base URL is available");
  }
  return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function isFhirJson(contentType: string | null | undefined): boolean {
  return Boolean(contentType && (contentType.includes("fhir+json") || contentType.includes("application/json")));
}

/**
 * Load the attachment content as a Blob. Inline base64 decodes directly;
 * URL attachments are fetched — FHIR Binary responses (JSON) are unwrapped,
 * anything else is taken as raw bytes.
 */
export async function loadDocumentBlob(
  resource: FhirResource,
  options: { fetcher?: typeof fetch; baseUrl?: string } = {}
): Promise<Blob> {
  const fetcher = options.fetcher ?? fetch;
  const attachment = documentAttachment(resource);
  if (!attachment) throw new Error("Document has no attachment content");
  if (attachment.data) {
    return base64ToBlob(attachment.data, attachment.contentType || "application/octet-stream");
  }
  if (!attachment.url) throw new Error("Document attachment has neither data nor url");

  const response = await fetcher(resolveAttachmentUrl(attachment.url, options.baseUrl), {
    headers: { Accept: "application/fhir+json, */*" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Attachment unavailable: ${response.status}${response.status === 401 || response.status === 403 ? " (sign-in may be required)" : ""}`);
  }
  if (isFhirJson(response.headers.get("content-type"))) {
    const binary = (await response.json()) as { resourceType?: string; contentType?: string; data?: string };
    if (binary.resourceType !== "Binary" || typeof binary.data !== "string") {
      throw new Error("Attachment endpoint did not return a FHIR Binary");
    }
    return base64ToBlob(binary.data, binary.contentType || attachment.contentType || "application/octet-stream");
  }
  return response.blob();
}
