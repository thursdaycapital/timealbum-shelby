"use client";

import { useState } from "react";

type PublishResult = {
  albumId: string;
  prefix: string;
  account: string;
  urls: {
    indexHtml: string;
    indexJson: string;
  };
  photoCount: number;
};

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setResult(null);

    const form = event.currentTarget;
    const filesInput = form.elements.namedItem("photos") as HTMLInputElement;
    const titleInput = form.elements.namedItem("title") as HTMLInputElement;
    const expirationInput = form.elements.namedItem("expiration") as HTMLInputElement;

    const files = Array.from(filesInput.files ?? []);
    if (files.length === 0) {
      setIsSubmitting(false);
      setError("Please select at least one photo.");
      return;
    }

    const meta: Record<string, number> = {};
    for (const file of files) {
      meta[file.name] = file.lastModified;
    }

    const formData = new FormData();
    formData.append("title", titleInput.value.trim());
    formData.append("expiration", expirationInput.value.trim());
    formData.append("meta", JSON.stringify(meta));
    for (const file of files) {
      formData.append("photos", file, file.name);
    }

    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Publish failed.");
      }

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main>
      <h1>Time Album (Shelby)</h1>
      <p>
        Upload photos to generate a time-based album and publish it to Shelby.
        The publisher organizes photos by date, generates index files, and
        returns public URLs.
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="title">Album title</label>
        <input id="title" name="title" type="text" placeholder="My weekend" />

        <label htmlFor="expiration">Expiration (e.g. 30d)</label>
        <input
          id="expiration"
          name="expiration"
          type="text"
          placeholder="30d"
        />

        <label htmlFor="photos">Photos</label>
        <input id="photos" name="photos" type="file" multiple accept="image/*" />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Publishing..." : "Publish album"}
        </button>

        {error ? <div className="error">{error}</div> : null}
      </form>

      {result ? (
        <div className="result">
          <h2>Published</h2>
          <p>
            Album ID: <strong>{result.albumId}</strong>
          </p>
          <p>
            Account: <strong>{result.account}</strong>
          </p>
          <p>
            Photos: <strong>{result.photoCount}</strong>
          </p>
          <p>
            index.html:{" "}
            <a href={result.urls.indexHtml} target="_blank" rel="noreferrer">
              {result.urls.indexHtml}
            </a>
          </p>
          <p>
            index.json:{" "}
            <a href={result.urls.indexJson} target="_blank" rel="noreferrer">
              {result.urls.indexJson}
            </a>
          </p>
        </div>
      ) : null}
    </main>
  );
}
