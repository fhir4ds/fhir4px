import { describe, expect, it, vi } from "vitest";
import {
  base64ToBlob,
  documentAttachment,
  loadDocumentBlob,
  mimeExtension,
  viewKindFor
} from "../../src/lib/fhir/document-viewer";
import type { FhirResource } from "../../src/lib/smart/data";

function documentReference(attachment: Record<string, unknown>): FhirResource {
  return {
    resourceType: "DocumentReference",
    status: "current",
    content: [{ attachment }]
  } as unknown as FhirResource;
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function jsonResponse(body: unknown, contentType = "application/fhir+json") {
  return {
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)], { type: contentType })
  };
}

describe("documentAttachment", () => {
  it("picks the first content element with data or url", () => {
    const resource = documentReference({ contentType: "text/plain", data: base64("hi") });
    expect(documentAttachment(resource)).toMatchObject({ contentType: "text/plain" });
    expect(documentAttachment(documentReference({ title: "no content" }))).toBeNull();
    expect(
      documentAttachment({
        content: [{ attachment: { title: "meta only" } }, { attachment: { url: "Binary/1", contentType: "application/pdf" } }]
      } as unknown as FhirResource)
    ).toMatchObject({ url: "Binary/1" });
  });
});

describe("base64ToBlob / mimeExtension", () => {
  it("round-trips base64 content", async () => {
    const blob = base64ToBlob(base64("hello document"), "text/plain");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello document");
  });
  it("maps mime types to file extensions", () => {
    expect(mimeExtension("text/plain")).toBe("txt");
    expect(mimeExtension("application/pdf")).toBe("pdf");
    expect(mimeExtension(undefined)).toBe("octetstream");
  });
});

describe("viewKindFor", () => {
  it("classifies by mime type", () => {
    expect(viewKindFor("text/plain")).toBe("text");
    expect(viewKindFor("text/html")).toBe("html");
    expect(viewKindFor("application/pdf")).toBe("pdf");
    expect(viewKindFor("image/png")).toBe("image");
    expect(viewKindFor("application/octet-stream")).toBe("download");
    expect(viewKindFor(undefined)).toBe("download");
  });
});

describe("loadDocumentBlob", () => {
  it("decodes inline base64 without fetching", async () => {
    const blob = await loadDocumentBlob(documentReference({ contentType: "text/plain", data: base64("inline") }));
    expect(await blob.text()).toBe("inline");
  });

  it("unwraps a FHIR Binary fetched by url", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://fhir.example/Binary/7");
      return jsonResponse({ resourceType: "Binary", contentType: "application/pdf", data: base64("%PDF-1.4") });
    });
    const blob = await loadDocumentBlob(documentReference({ url: "https://fhir.example/Binary/7" }), fetchMock as unknown as typeof fetch);
    expect(blob.type).toBe("application/pdf");
    expect(await blob.text()).toBe("%PDF-1.4");
  });

  it("takes non-FHIR responses as raw bytes", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("raw", "image/png"));
    const blob = await loadDocumentBlob(documentReference({ url: "https://fhir.example/img" }), fetchMock as unknown as typeof fetch);
    expect(blob.type).toBe("image/png");
  });

  it("surfaces fetch failures", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => null } }));
    await expect(
      loadDocumentBlob(documentReference({ url: "https://fhir.example/x" }), fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(/sign-in may be required/);
  });
});
